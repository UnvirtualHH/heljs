import { parse } from "@babel/parser";
import * as generateModule from "@babel/generator";
import * as traverseModule from "@babel/traverse";
import type { NodePath, Visitor } from "@babel/traverse";
import * as t from "@babel/types";
import type { Plugin } from "vite";

function unwrapCallable(moduleValue: unknown): (...args: unknown[]) => unknown {
  let current = moduleValue;

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current === "function") {
      return current as (...args: unknown[]) => unknown;
    }

    if (
      typeof current === "object" &&
      current !== null &&
      "default" in (current as { default?: unknown })
    ) {
      current = (current as { default?: unknown }).default;
      continue;
    }

    break;
  }

  throw new Error("Expected callable module export");
}

const traverse = unwrapCallable(traverseModule) as (typeof import("@babel/traverse"))["default"];
const generate = unwrapCallable(generateModule) as (typeof import("@babel/generator"))["default"];

type UsedHelpers = {
  cell: boolean;
  get: boolean;
  set: boolean;
  h: boolean;
  node: boolean;
  dynText: boolean;
  dynAttr: boolean;
  dynBlock: boolean;
  frag: boolean;
};

type ReactiveInfo = {
  cellName: string;
  bindingIdentifier: t.Identifier;
};

type LocalFunctionPath = NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>;

type LocalFunctionInfo = {
  bindingIdentifier: t.Identifier;
  path: LocalFunctionPath;
  readsReactive: boolean;
  returnsBlock: boolean;
  calls: Set<t.Identifier>;
};

type ComponentAnalysis = {
  reactiveCellNames: Set<string>;
  reactiveFunctionNames: Set<string>;
  blockFunctionNames: Set<string>;
};

type ComponentTransformResult = {
  analysis: ComponentAnalysis;
  changed: boolean;
};

const RUNTIME_SOURCE = "@hel/runtime";
const COMPONENT_NAME = /^[A-Z]/;
const EVENT_PROP = /^on[A-Z]/;
const BINARY_ASSIGNMENTS = new Set([
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "<<=",
  ">>=",
  ">>>=",
  "|=",
  "^=",
  "&=",
]);

function createUsedHelpers(): UsedHelpers {
  return {
    cell: false,
    get: false,
    set: false,
    h: false,
    node: false,
    dynText: false,
    dynAttr: false,
    dynBlock: false,
    frag: false,
  };
}

function isComponentName(name: string): boolean {
  return COMPONENT_NAME.test(name);
}

function shouldRewrite(name: string, path: NodePath, reactive: Map<string, ReactiveInfo>): boolean {
  const info = reactive.get(name);
  if (!info) {
    return false;
  }

  const binding = path.scope.getBinding(name);
  return Boolean(binding && binding.identifier === info.bindingIdentifier);
}

function wrapTextDynamic(expression: t.Expression, used: UsedHelpers): t.Expression {
  used.dynText = true;
  return t.callExpression(t.identifier("__dynText"), [t.arrowFunctionExpression([], expression)]);
}

function wrapAttrDynamic(expression: t.Expression, used: UsedHelpers): t.Expression {
  used.dynAttr = true;
  return t.callExpression(t.identifier("__dynAttr"), [t.arrowFunctionExpression([], expression)]);
}

function wrapBlockDynamic(expression: t.Expression, used: UsedHelpers): t.Expression {
  used.dynBlock = true;
  return t.callExpression(t.identifier("__dynBlock"), [t.arrowFunctionExpression([], expression)]);
}

function wrapNodeFactory(expression: t.Expression, used: UsedHelpers): t.Expression {
  used.node = true;
  return t.callExpression(t.identifier("__node"), [t.arrowFunctionExpression([], expression)]);
}

function normalizeExpression(
  node: t.Expression | t.JSXElement | t.JSXFragment,
  used: UsedHelpers,
  analysis?: ComponentAnalysis,
): t.Expression {
  if (t.isJSXElement(node)) {
    return buildJsxElement(node, used, analysis);
  }

  if (t.isJSXFragment(node)) {
    return buildJsxFragment(node, used, analysis);
  }

  return node;
}

function toObjectKey(name: string): t.Identifier | t.StringLiteral {
  return t.isValidIdentifier(name) ? t.identifier(name) : t.stringLiteral(name);
}

function jsxNameToExpression(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): t.Expression {
  if (t.isJSXIdentifier(name)) {
    if (isComponentName(name.name)) {
      return t.identifier(name.name);
    }

    return t.stringLiteral(name.name);
  }

  if (t.isJSXNamespacedName(name)) {
    return t.stringLiteral(`${name.namespace.name}:${name.name.name}`);
  }

  return t.memberExpression(
    jsxNameToExpression(name.object) as t.Expression,
    t.identifier(name.property.name),
  );
}

function getLooseIdentifierName(node: t.Node): string | null {
  const candidate = node as { type?: string; name?: unknown };
  return candidate.type === "Identifier" && typeof candidate.name === "string" ? candidate.name : null;
}

function registerLocalFunction(
  bindingIdentifier: t.Identifier,
  path: LocalFunctionPath,
  localFunctions: Map<t.Identifier, LocalFunctionInfo>,
): void {
  if (localFunctions.has(bindingIdentifier)) {
    return;
  }

  localFunctions.set(bindingIdentifier, {
    bindingIdentifier,
    path,
    readsReactive: false,
    returnsBlock: false,
    calls: new Set<t.Identifier>(),
  });
}

function collectLocalFunctions(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
): Map<t.Identifier, LocalFunctionInfo> {
  const localFunctions = new Map<t.Identifier, LocalFunctionInfo>();

  functionPath.traverse({
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (path === functionPath || !path.node.id) {
        return;
      }

      registerLocalFunction(path.node.id, path, localFunctions);
    },

    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      if (!t.isIdentifier(path.node.id)) {
        return;
      }

      const initPath = path.get("init");
      if (!initPath.isFunctionExpression() && !initPath.isArrowFunctionExpression()) {
        return;
      }

      registerLocalFunction(path.node.id, initPath, localFunctions);
    },
  });

  return localFunctions;
}

function resolveLocalFunctionBinding(
  identifierPath: NodePath<t.Identifier>,
  localFunctions: Map<t.Identifier, LocalFunctionInfo>,
): t.Identifier | null {
  const binding = identifierPath.scope.getBinding(identifierPath.node.name);
  if (!binding || !t.isIdentifier(binding.identifier)) {
    return null;
  }

  return localFunctions.has(binding.identifier) ? binding.identifier : null;
}

function functionContainsBlockSyntax(path: LocalFunctionPath): boolean {
  let found = false;

  path.traverse({
    Function(innerPath: NodePath<t.Function>) {
      if (innerPath !== path) {
        innerPath.skip();
      }
    },

    JSXElement() {
      found = true;
    },

    JSXFragment() {
      found = true;
    },
  });

  return found;
}

function analyzeLocalFunctions(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
  reactive: Map<string, ReactiveInfo>,
): { reactiveFunctions: Set<t.Identifier>; blockFunctions: Set<t.Identifier> } {
  const localFunctions = collectLocalFunctions(functionPath);

  for (const info of localFunctions.values()) {
    info.returnsBlock = functionContainsBlockSyntax(info.path);

    info.path.traverse({
      Function(path: NodePath<t.Function>) {
        if (path !== info.path) {
          path.skip();
        }
      },

      Identifier(path: NodePath<t.Identifier>) {
        if (!path.isReferencedIdentifier()) {
          return;
        }

        if (shouldRewrite(path.node.name, path, reactive)) {
          info.readsReactive = true;
        }
      },

      CallExpression(path: NodePath<t.CallExpression>) {
        const calleePath = path.get("callee");
        if (!calleePath.isIdentifier()) {
          return;
        }

        const bindingIdentifier = resolveLocalFunctionBinding(calleePath, localFunctions);
        if (bindingIdentifier) {
          info.calls.add(bindingIdentifier);
        }
      },
    });
  }

  const reactiveFunctions = new Set<t.Identifier>();
  let pendingReactive = true;

  while (pendingReactive) {
    pendingReactive = false;

    for (const info of localFunctions.values()) {
      if (reactiveFunctions.has(info.bindingIdentifier)) {
        continue;
      }

      if (info.readsReactive || Array.from(info.calls).some((callee) => reactiveFunctions.has(callee))) {
        reactiveFunctions.add(info.bindingIdentifier);
        pendingReactive = true;
      }
    }
  }

  const blockFunctions = new Set<t.Identifier>();
  let pendingBlock = true;

  while (pendingBlock) {
    pendingBlock = false;

    for (const info of localFunctions.values()) {
      if (blockFunctions.has(info.bindingIdentifier)) {
        continue;
      }

      if (info.returnsBlock || Array.from(info.calls).some((callee) => blockFunctions.has(callee))) {
        blockFunctions.add(info.bindingIdentifier);
        pendingBlock = true;
      }
    }
  }

  return {
    reactiveFunctions,
    blockFunctions,
  };
}

function isRuntimeReactiveRead(node: t.Node, analysis?: ComponentAnalysis): boolean {
  if (!analysis || !t.isCallExpression(node) || !t.isIdentifier(node.callee, { name: "__get" })) {
    return false;
  }

  if (node.arguments.length !== 1) {
    return false;
  }

  const [argument] = node.arguments;
  return t.isIdentifier(argument) && analysis.reactiveCellNames.has(argument.name);
}

function hasReactiveDependency(node: t.Expression, analysis?: ComponentAnalysis): boolean {
  if (!analysis) {
    return false;
  }

  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    return false;
  }

  const stack: t.Node[] = [node];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (isRuntimeReactiveRead(current, analysis)) {
      return true;
    }

    if (
      t.isCallExpression(current) &&
      t.isIdentifier(current.callee) &&
      analysis.reactiveFunctionNames.has(current.callee.name)
    ) {
      return true;
    }

    for (const key of t.VISITOR_KEYS[current.type] ?? []) {
      const child = (current as unknown as Record<string, unknown>)[key];

      if (Array.isArray(child)) {
        for (let index = child.length - 1; index >= 0; index -= 1) {
          const entry = child[index];
          if (t.isNode(entry)) {
            stack.push(entry);
          }
        }
        continue;
      }

      if (t.isNode(child)) {
        stack.push(child);
      }
    }
  }

  return false;
}

function expressionProducesBlock(node: t.Expression, analysis?: ComponentAnalysis): boolean {
  if (!analysis) {
    return false;
  }

  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    return false;
  }

  const stack: t.Node[] = [node];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (t.isCallExpression(current)) {
      const callee = current.callee;

      if (t.isIdentifier(callee, { name: "__h" }) || t.isIdentifier(callee, { name: "__frag" })) {
        return true;
      }

      const calleeName = getLooseIdentifierName(callee);
      if (calleeName && analysis.blockFunctionNames.has(calleeName)) {
        return true;
      }
    }

    for (const key of t.VISITOR_KEYS[current.type] ?? []) {
      const child = (current as unknown as Record<string, unknown>)[key];

      if (Array.isArray(child)) {
        for (let index = child.length - 1; index >= 0; index -= 1) {
          const entry = child[index];
          if (t.isNode(entry)) {
            stack.push(entry);
          }
        }
        continue;
      }

      if (t.isNode(child)) {
        stack.push(child);
      }
    }
  }

  return false;
}

function buildJsxChildren(
  children: Array<t.JSXText | t.JSXExpressionContainer | t.JSXElement | t.JSXFragment | t.JSXSpreadChild>,
  used: UsedHelpers,
  analysis?: ComponentAnalysis,
): t.Expression[] {
  const output: t.Expression[] = [];

  for (const child of children) {
    if (t.isJSXText(child)) {
      const normalized = child.value.replace(/\s+/g, " ");
      if (normalized.trim().length > 0) {
        output.push(t.stringLiteral(normalized));
      }
      continue;
    }

    if (t.isJSXSpreadChild(child)) {
      const normalized = normalizeExpression(child.expression, used, analysis);
      if (!hasReactiveDependency(normalized, analysis)) {
        output.push(expressionProducesBlock(normalized, analysis) ? wrapNodeFactory(normalized, used) : normalized);
        continue;
      }

      output.push(expressionProducesBlock(normalized, analysis) ? wrapBlockDynamic(normalized, used) : wrapTextDynamic(normalized, used));
      continue;
    }

    if (t.isJSXElement(child)) {
      output.push(wrapNodeFactory(buildJsxElement(child, used, analysis), used));
      continue;
    }

    if (t.isJSXFragment(child)) {
      output.push(wrapNodeFactory(buildJsxFragment(child, used, analysis), used));
      continue;
    }

    if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      const normalized = normalizeExpression(child.expression, used, analysis);
      if (!hasReactiveDependency(normalized, analysis)) {
        output.push(expressionProducesBlock(normalized, analysis) ? wrapNodeFactory(normalized, used) : normalized);
        continue;
      }

      output.push(expressionProducesBlock(normalized, analysis) ? wrapBlockDynamic(normalized, used) : wrapTextDynamic(normalized, used));
    }
  }

  return output;
}

function buildJsxProps(
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  used: UsedHelpers,
  analysis?: ComponentAnalysis,
): t.Expression {
  if (attributes.length === 0) {
    return t.nullLiteral();
  }

  const properties: Array<t.ObjectProperty | t.SpreadElement> = [];

  for (const attribute of attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      properties.push(t.spreadElement(attribute.argument));
      continue;
    }

    if (!t.isJSXIdentifier(attribute.name)) {
      continue;
    }

    const name = attribute.name.name;
    let value: t.Expression;

    if (attribute.value === null) {
      value = t.booleanLiteral(true);
    } else if (t.isStringLiteral(attribute.value)) {
      value = attribute.value;
    } else if (t.isJSXExpressionContainer(attribute.value) && !t.isJSXEmptyExpression(attribute.value.expression)) {
      const normalized = normalizeExpression(attribute.value.expression, used, analysis);
      value = EVENT_PROP.test(name) || !hasReactiveDependency(normalized, analysis)
        ? normalized
        : wrapAttrDynamic(normalized, used);
    } else {
      value = t.booleanLiteral(true);
    }

    properties.push(t.objectProperty(toObjectKey(name), value));
  }

  return t.objectExpression(properties);
}

function buildJsxElement(element: t.JSXElement, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  used.h = true;

  return t.callExpression(t.identifier("__h"), [
    jsxNameToExpression(element.openingElement.name),
    buildJsxProps(element.openingElement.attributes, used, analysis),
    ...buildJsxChildren(element.children, used, analysis),
  ]);
}

function buildJsxFragment(fragment: t.JSXFragment, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  used.frag = true;

  return t.callExpression(t.identifier("__frag"), buildJsxChildren(fragment.children, used, analysis));
}

function transformComponent(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
  used: UsedHelpers,
): ComponentTransformResult {
  const bodyPath = functionPath.get("body");
  if (!bodyPath.isBlockStatement()) {
    return {
      analysis: {
        reactiveCellNames: new Set<string>(),
        reactiveFunctionNames: new Set<string>(),
        blockFunctionNames: new Set<string>(),
      },
      changed: false,
    };
  }

  const reactive = new Map<string, ReactiveInfo>();
  let changed = false;
  let cellCounter = 0;

  for (const statementPath of bodyPath.get("body")) {
    if (!statementPath.isVariableDeclaration({ kind: "let" })) {
      continue;
    }

    for (const declaration of statementPath.node.declarations) {
      if (!t.isIdentifier(declaration.id)) {
        continue;
      }

      const sourceName = declaration.id.name;
      const cellName = `__cell_${sourceName}_${cellCounter++}`;
      reactive.set(sourceName, {
        cellName,
        bindingIdentifier: declaration.id,
      });
    }
  }

  const { reactiveFunctions, blockFunctions } = analyzeLocalFunctions(functionPath, reactive);

  for (const statementPath of bodyPath.get("body")) {
    if (!statementPath.isVariableDeclaration({ kind: "let" })) {
      continue;
    }

    const transformed: t.VariableDeclarator[] = [];
    const untouched: t.VariableDeclarator[] = [];

    for (const declaration of statementPath.node.declarations) {
      if (!t.isIdentifier(declaration.id)) {
        untouched.push(declaration);
        continue;
      }

      const info = reactive.get(declaration.id.name);
      if (!info) {
        untouched.push(declaration);
        continue;
      }

      transformed.push(
        t.variableDeclarator(
          t.identifier(info.cellName),
          t.callExpression(t.identifier("__cell"), [declaration.init ?? t.identifier("undefined")]),
        ),
      );
    }

    const replacements: t.Statement[] = [];

    if (transformed.length > 0) {
      replacements.push(t.variableDeclaration("const", transformed));
      used.cell = true;
      changed = true;
    }

    if (untouched.length > 0) {
      replacements.push(t.variableDeclaration("let", untouched));
    }

    if (replacements.length === 1) {
      statementPath.replaceWith(replacements[0]);
    } else if (replacements.length > 1) {
      statementPath.replaceWithMultiple(replacements);
    }
  }

  if (reactive.size === 0) {
    return {
      analysis: {
        reactiveCellNames: new Set<string>(),
        reactiveFunctionNames: new Set<string>(),
        blockFunctionNames: new Set<string>(),
      },
      changed,
    };
  }

  const rewriteVisitor: Visitor = {
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      const leftPath = path.get("left");
      if (!leftPath.isIdentifier()) {
        return;
      }

      const name = leftPath.node.name;
      const info = reactive.get(name);
      if (!info || !shouldRewrite(name, path, reactive)) {
        return;
      }
      const cellName = info.cellName;

      let nextValue: t.Expression | null = null;

      if (path.node.operator === "=") {
        nextValue = path.node.right;
      } else if (BINARY_ASSIGNMENTS.has(path.node.operator)) {
        used.get = true;

        nextValue = t.binaryExpression(
          path.node.operator.slice(0, -1) as t.BinaryExpression["operator"],
          t.callExpression(t.identifier("__get"), [t.identifier(cellName)]),
          path.node.right,
        );
      } else if (path.node.operator === "&&=") {
        used.get = true;
        nextValue = t.logicalExpression(
          "&&",
          t.callExpression(t.identifier("__get"), [t.identifier(cellName)]),
          path.node.right,
        );
      } else if (path.node.operator === "||=") {
        used.get = true;
        nextValue = t.logicalExpression(
          "||",
          t.callExpression(t.identifier("__get"), [t.identifier(cellName)]),
          path.node.right,
        );
      } else if (path.node.operator === "??=") {
        used.get = true;
        nextValue = t.logicalExpression(
          "??",
          t.callExpression(t.identifier("__get"), [t.identifier(cellName)]),
          path.node.right,
        );
      }

      if (!nextValue) {
        return;
      }

      used.set = true;
      path.replaceWith(t.callExpression(t.identifier("__set"), [t.identifier(cellName), nextValue]));
      changed = true;
    },

    UpdateExpression(path: NodePath<t.UpdateExpression>) {
      const argumentPath = path.get("argument");
      if (!argumentPath.isIdentifier()) {
        return;
      }

      const name = argumentPath.node.name;
      const info = reactive.get(name);
      if (!info || !shouldRewrite(name, path, reactive)) {
        return;
      }
      const cellName = info.cellName;

      used.get = true;
      used.set = true;
      changed = true;

      const delta = path.node.operator === "++" ? 1 : -1;
      const readCurrent = t.callExpression(t.identifier("__get"), [t.identifier(cellName)]);

      if (path.node.prefix) {
        path.replaceWith(
          t.callExpression(t.identifier("__set"), [
            t.identifier(cellName),
            t.binaryExpression("+", readCurrent, t.numericLiteral(delta)),
          ]),
        );
        path.skip();
        return;
      }

      const previousIdentifier = path.scope.generateUidIdentifier("previous");

      path.replaceWith(
        t.callExpression(
          t.arrowFunctionExpression(
            [],
            t.blockStatement([
              t.variableDeclaration("const", [
                t.variableDeclarator(previousIdentifier, t.callExpression(t.identifier("__get"), [t.identifier(cellName)])),
              ]),
              t.expressionStatement(
                t.callExpression(t.identifier("__set"), [
                  t.identifier(cellName),
                  t.binaryExpression("+", previousIdentifier, t.numericLiteral(delta)),
                ]),
              ),
              t.returnStatement(previousIdentifier),
            ]),
          ),
          [],
        ),
      );
      path.skip();
    },

    Identifier(path: NodePath<t.Identifier>) {
      if (!path.isReferencedIdentifier()) {
        return;
      }

      const name = path.node.name;
      const info = reactive.get(name);
      if (!info || !shouldRewrite(name, path, reactive)) {
        return;
      }
      const cellName = info.cellName;

      const parentPath = path.parentPath;
      if (
        parentPath.isObjectProperty() &&
        parentPath.node.shorthand &&
        parentPath.node.value === path.node
      ) {
        parentPath.node.shorthand = false;
      }

      used.get = true;
      changed = true;
      path.replaceWith(t.callExpression(t.identifier("__get"), [t.identifier(cellName)]));
      path.skip();
    },
  };

  functionPath.traverse(rewriteVisitor);

  return {
    analysis: {
      reactiveCellNames: new Set(Array.from(reactive.values(), (info) => info.cellName)),
      reactiveFunctionNames: new Set(Array.from(reactiveFunctions, (identifier) => identifier.name)),
      blockFunctionNames: new Set(Array.from(blockFunctions, (identifier) => identifier.name)),
    },
    changed,
  };
}

function injectRuntimeImport(ast: t.File, used: UsedHelpers): void {
  const requested: Array<{ imported: string; local: string; enabled: boolean }> = [
    { imported: "cell", local: "__cell", enabled: used.cell },
    { imported: "get", local: "__get", enabled: used.get },
    { imported: "set", local: "__set", enabled: used.set },
    { imported: "h", local: "__h", enabled: used.h },
    { imported: "node", local: "__node", enabled: used.node },
    { imported: "dynText", local: "__dynText", enabled: used.dynText },
    { imported: "dynAttr", local: "__dynAttr", enabled: used.dynAttr },
    { imported: "dynBlock", local: "__dynBlock", enabled: used.dynBlock },
    { imported: "frag", local: "__frag", enabled: used.frag },
  ].filter((entry) => entry.enabled);

  if (requested.length === 0) {
    return;
  }

  const program = ast.program;
  let runtimeImport: t.ImportDeclaration | undefined;

  for (const node of program.body) {
    if (t.isImportDeclaration(node) && node.source.value === RUNTIME_SOURCE) {
      runtimeImport = node;
      break;
    }
  }

  if (!runtimeImport) {
    runtimeImport = t.importDeclaration([], t.stringLiteral(RUNTIME_SOURCE));
    program.body.unshift(runtimeImport);
  }

  const existing = new Set(
    runtimeImport.specifiers
      .filter((specifier): specifier is t.ImportSpecifier => t.isImportSpecifier(specifier))
      .map((specifier) => specifier.local.name),
  );

  for (const helper of requested) {
    if (existing.has(helper.local)) {
      continue;
    }

    runtimeImport.specifiers.push(
      t.importSpecifier(t.identifier(helper.local), t.identifier(helper.imported)),
    );
  }
}

function findComponentAnalysis(
  path: NodePath,
  componentAnalyses: WeakMap<t.Node, ComponentAnalysis>,
): ComponentAnalysis | undefined {
  let current: NodePath | null = path;

  while (current) {
    if (current.isFunction() && componentAnalyses.has(current.node)) {
      return componentAnalyses.get(current.node);
    }

    current = current.parentPath;
  }

  return undefined;
}

export function helMagicPlugin(): Plugin {
  return {
    name: "hel-magic-plugin",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[jt]sx$/.test(id) || id.includes("node_modules")) {
        return null;
      }

      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
      });

      const used = createUsedHelpers();
      let changed = false;
      const componentAnalyses = new WeakMap<t.Node, ComponentAnalysis>();

      traverse(ast, {
        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          if (!path.node.id || !isComponentName(path.node.id.name)) {
            return;
          }

          const result = transformComponent(path, used);
          componentAnalyses.set(path.node, result.analysis);
          if (result.changed) {
            changed = true;
          }
        },

        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
          if (!t.isIdentifier(path.node.id) || !isComponentName(path.node.id.name)) {
            return;
          }

          if (!path.parentPath.isVariableDeclaration()) {
            return;
          }

          const initPath = path.get("init");
          if (!initPath.isFunctionExpression() && !initPath.isArrowFunctionExpression()) {
            return;
          }

          const result = transformComponent(initPath, used);
          componentAnalyses.set(initPath.node, result.analysis);
          if (result.changed) {
            changed = true;
          }
        },
      });

      traverse(ast, {
        JSXElement(path: NodePath<t.JSXElement>) {
          const analysis = findComponentAnalysis(path, componentAnalyses);
          path.replaceWith(buildJsxElement(path.node, used, analysis));
          changed = true;
        },
        JSXFragment(path: NodePath<t.JSXFragment>) {
          const analysis = findComponentAnalysis(path, componentAnalyses);
          path.replaceWith(buildJsxFragment(path.node, used, analysis));
          changed = true;
        },
      });

      if (!changed) {
        return null;
      }

      injectRuntimeImport(ast, used);

      const output = generate(
        ast,
        {
          sourceMaps: true,
          sourceFileName: id,
          retainLines: true,
        },
        code,
      );

      return {
        code: output.code,
        map: output.map,
      };
    },
  };
}
