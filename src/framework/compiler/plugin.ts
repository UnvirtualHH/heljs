import { parse } from "@babel/parser";
import * as generateModule from "@babel/generator";
import * as traverseModule from "@babel/traverse";
import type { NodePath, Visitor } from "@babel/traverse";
import * as t from "@babel/types";
import type { Plugin } from "vite";
import { SVG_TAGS } from "../shared";

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
  memo: boolean;
  get: boolean;
  set: boolean;
  component: boolean;
  h: boolean;
  node: boolean;
  text: boolean;
  attr: boolean;
  branch: boolean;
  tpl: boolean;
  row: boolean;
  tree: boolean;
  trees: Map<string, t.Identifier>;
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
  returnsBlock: boolean;
  calls: Set<t.Identifier>;
};

type ComponentAnalysis = {
  blockFunctionNames: Set<string>;
};

type ComponentTransformResult = {
  analysis: ComponentAnalysis;
  changed: boolean;
};

// alias: re-reads a member path or prop, nothing to cache.
// memo: computed at the declaration, then once per change.
// lazy: like memo, but first computed where it is read, since JSX must not
// claim prerendered nodes before its position in the tree.
type DerivedKind = "alias" | "memo" | "lazy";

type ReactiveScopeKind = "component" | "hook";

type DerivedInfo = {
  bindingIdentifier: t.Identifier;
  functionIdentifier: t.Identifier;
  returnsBlock: boolean;
  kind: DerivedKind;
  factory: t.ArrowFunctionExpression;
};

type ComponentName = string;

const RUNTIME_SOURCE = "hel/runtime";
const RUNTIME_IMPORT_SOURCES = new Set([RUNTIME_SOURCE, "hel"]);
const COMPONENT_NAME = /^[A-Z]/;
const HOOK_NAME = /^use[A-Z]/;
const FACTORY_NAME = /^create[A-Z]/;
const HOOK_DECLARATION = /\bfunction\s+use[A-Z]|\buse[A-Z]\w*\s*=/;
const SETUP_CALLS = new Set(["store", "untrack", "memo", "list", "ref", "effect", "cell", "component"]);
const EVENT_PROP = /^on[A-Z]/;
const RAW_TEXT_TAGS = new Set(["textarea", "title", "script", "style"]);
const STATIC_ATTRIBUTE_NAMES: Record<string, string> = { className: "class", htmlFor: "for" };
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
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

// Calls to the runtime's list(). They manage their own reactivity, so they must
// reach the keyed list slot directly instead of being wrapped in a block.
const keyedListCalls = new WeakSet<t.Node>();

function isRuntimeListCall(path: NodePath<t.CallExpression>): boolean {
  const callee = path.node.callee;
  return t.isIdentifier(callee) && isRuntimeImport(path, callee.name, "list");
}

function isRuntimeImport(path: NodePath, name: string, imported: string): boolean {
  const binding = path.scope.getBinding(name);
  if (!binding || !binding.path.isImportSpecifier()) {
    return false;
  }

  const declaration = binding.path.parent;
  return (
    t.isImportDeclaration(declaration) &&
    RUNTIME_IMPORT_SOURCES.has(declaration.source.value) &&
    t.isIdentifier(binding.path.node.imported, { name: imported })
  );
}

type RowFunction = NodePath<t.ArrowFunctionExpression | t.FunctionExpression>;

// What a row's parameter reads: the item itself, or one property of it.
function rowParameterBindings(parameter: NodePath, functionPath: RowFunction): Array<{ name: string; property: string | null }> | null {
  if (parameter.isIdentifier()) {
    return [{ name: parameter.node.name, property: null }];
  }

  if (!parameter.isObjectPattern()) {
    return null;
  }

  const bindings: Array<{ name: string; property: string | null }> = [];

  for (const property of parameter.node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isIdentifier(property.key) || !t.isIdentifier(property.value)) {
      return null;
    }
    bindings.push({ name: property.value.name, property: property.key.name });
  }

  return functionPath.scope ? bindings : null;
}

function replaceRowReferences(
  functionPath: RowFunction,
  bindings: Array<{ name: string; property: string | null }>,
  read: (reference: NodePath, property: string | null) => void,
): void {
  for (const { name, property } of bindings) {
    for (const reference of functionPath.scope.getBinding(name)!.referencePaths) {
      const parent = reference.parentPath;
      if (parent?.isObjectProperty({ shorthand: true })) {
        parent.node.shorthand = false;
      }
      read(reference, property);
    }
  }
}

// The property a key function reads, when that is all it does: row => row.id.
function keyPropertyOf(key: t.Node | null | undefined): string | null {
  if (!t.isArrowFunctionExpression(key) || key.params.length === 0) {
    return null;
  }

  const [parameter] = key.params;
  const { body } = key;

  if (
    t.isIdentifier(parameter) &&
    t.isMemberExpression(body) &&
    !body.computed &&
    t.isIdentifier(body.object, { name: parameter.name }) &&
    t.isIdentifier(body.property)
  ) {
    return body.property.name;
  }

  if (t.isObjectPattern(parameter) && t.isIdentifier(body)) {
    for (const property of parameter.properties) {
      if (t.isObjectProperty(property) && !property.computed && t.isIdentifier(property.key) && t.isIdentifier(property.value, { name: body.name })) {
        return property.key.name;
      }
    }
  }

  return null;
}

// A keyed row stays alive when a refetch brings a new object for its key, so what
// was typed into it survives. Its parameters read the current value, like props.
// Anything this cannot rewrite safely stays plain and renders the row again.
function makeRowLive(functionPath: RowFunction, used: UsedHelpers, keyProperty: string | null): t.CallExpression | null {
  const [itemParameter, indexParameter, ...rest] = functionPath.get("params") as NodePath[];
  if (!itemParameter || rest.length > 0) {
    return null;
  }

  const itemBindings = rowParameterBindings(itemParameter, functionPath);
  const indexBindings = indexParameter ? rowParameterBindings(indexParameter, functionPath) : [];
  if (!itemBindings || !indexBindings || indexBindings.some((binding) => binding.property !== null)) {
    return null;
  }

  const unsafe = [...itemBindings, ...indexBindings].some(({ name }) => {
    const binding = functionPath.scope.getBinding(name);
    return !binding || !binding.constant || binding.referencePaths.some((reference) => reference.isJSXIdentifier());
  });
  if (unsafe) {
    return null;
  }

  const readItem = functionPath.scope.generateUidIdentifier("item");
  const readIndex = functionPath.scope.generateUidIdentifier("index");
  const rowKey = functionPath.scope.generateUidIdentifier("key");
  let usesKey = false;

  replaceRowReferences(functionPath, itemBindings, (reference, property) => {
    // A row keeps its key for life, so reading it needs no slot at all.
    if (keyProperty !== null && property === keyProperty) {
      usesKey = true;
      reference.replaceWith(t.cloneNode(rowKey));
      return;
    }

    const parent = reference.parentPath;
    if (
      keyProperty !== null &&
      property === null &&
      parent?.isMemberExpression({ computed: false }) &&
      parent.node.object === reference.node &&
      t.isIdentifier(parent.node.property, { name: keyProperty }) &&
      !parent.parentPath.isAssignmentExpression({ left: parent.node }) &&
      !parent.parentPath.isUpdateExpression()
    ) {
      usesKey = true;
      parent.replaceWith(t.cloneNode(rowKey));
      return;
    }

    const value = t.callExpression(t.cloneNode(readItem), []);
    reference.replaceWith(property ? t.memberExpression(value, t.identifier(property)) : value);
  });
  replaceRowReferences(functionPath, indexBindings, (reference) => {
    reference.replaceWith(t.callExpression(t.cloneNode(readIndex), []));
  });

  functionPath.node.params = usesKey ? [readItem, readIndex, rowKey] : indexParameter ? [readItem, readIndex] : [readItem];
  used.row = true;
  return t.callExpression(t.identifier("__row"), [functionPath.node]);
}

function createUsedHelpers(): UsedHelpers {
  return {
    cell: false,
    memo: false,
    get: false,
    set: false,
    component: false,
    h: false,
    node: false,
    text: false,
    attr: false,
    branch: false,
    tpl: false,
    row: false,
    tree: false,
    trees: new Map<string, t.Identifier>(),
    dynText: false,
    dynAttr: false,
    dynBlock: false,
    frag: false,
  };
}

function isComponentName(name: string): boolean {
  return COMPONENT_NAME.test(name);
}

function isHookName(name: string): boolean {
  return HOOK_NAME.test(name);
}

function stripTypeWrappers(node: t.Expression): t.Expression {
  let current = node;

  while (
    t.isTSAsExpression(current) ||
    t.isTSNonNullExpression(current) ||
    t.isTSSatisfiesExpression(current) ||
    t.isTSTypeAssertion(current)
  ) {
    current = current.expression;
  }

  return current;
}

// Calls that create something once. Running them again on a state change
// would lose what they created, so they never become derived values.
function isSetupCall(node: t.Node): boolean {
  if (t.isNewExpression(node)) {
    return true;
  }

  if (!t.isCallExpression(node)) {
    return false;
  }

  // Only hooks count on a member call: api.createUrl(id) is usually a plain helper.
  if (t.isMemberExpression(node.callee) && !node.callee.computed && t.isIdentifier(node.callee.property)) {
    return HOOK_NAME.test(node.callee.property.name);
  }

  if (!t.isIdentifier(node.callee)) {
    return false;
  }

  const { name } = node.callee;
  return SETUP_CALLS.has(name) || HOOK_NAME.test(name) || FACTORY_NAME.test(name);
}

function pushChildNodes(node: t.Node, stack: t.Node[]): void {
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key];

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

function isReadLikeExpression(node: t.Node): boolean {
  return (
    t.isCallExpression(node) ||
    t.isOptionalCallExpression(node) ||
    t.isMemberExpression(node) ||
    t.isOptionalMemberExpression(node) ||
    t.isTaggedTemplateExpression(node) ||
    t.isNewExpression(node)
  );
}

// The compiler cannot see across modules, so anything that might read state is
// dynamic and the runtime finds the real dependencies. Runs on rewritten code,
// where a reactive let is already a __get() call. Nested JSX has its own slots.
function isDynamicExpression(root: t.Node): boolean {
  const stack: t.Node[] = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (t.isFunction(current) || t.isJSXElement(current) || t.isJSXFragment(current) || t.isTSType(current)) {
      continue;
    }

    if (
      t.isCallExpression(current) &&
      (t.isIdentifier(current.callee, { name: "__h" }) || t.isIdentifier(current.callee, { name: "__frag" }) || t.isIdentifier(current.callee, { name: "__tree" }))
    ) {
      continue;
    }

    if (isReadLikeExpression(current)) {
      return true;
    }

    if (t.isObjectProperty(current) && !current.computed) {
      stack.push(current.value);
      continue;
    }

    pushChildNodes(current, stack);
  }

  return false;
}

// The same rule for code that has not been rewritten yet, where reactive
// bindings are still plain identifiers.
function expressionReadsState(root: t.Node, isReactiveIdentifier: (name: string) => boolean): boolean {
  const stack: t.Node[] = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (
      t.isFunction(current) ||
      t.isJSXElement(current) ||
      t.isJSXFragment(current) ||
      t.isTSType(current) ||
      isSetupCall(current)
    ) {
      continue;
    }

    if (isReadLikeExpression(current)) {
      return true;
    }

    if (t.isIdentifier(current)) {
      if (isReactiveIdentifier(current.name)) {
        return true;
      }
      continue;
    }

    if (t.isObjectProperty(current) && !current.computed) {
      stack.push(current.value);
      continue;
    }

    pushChildNodes(current, stack);
  }

  return false;
}

function containsJsx(root: t.Node): boolean {
  const stack: t.Node[] = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (t.isJSXElement(current) || t.isJSXFragment(current)) {
      return true;
    }

    pushChildNodes(current, stack);
  }

  return false;
}

function isMemberPath(node: t.Node): boolean {
  if (t.isIdentifier(node)) {
    return true;
  }

  if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) {
    return false;
  }

  if (node.computed && !t.isStringLiteral(node.property) && !t.isNumericLiteral(node.property)) {
    return false;
  }

  return isMemberPath(node.object);
}

function classifyConstInitializer(
  initializer: t.Expression,
  isReactiveIdentifier: (name: string) => boolean,
): DerivedKind | null {
  const node = stripTypeWrappers(initializer);

  if (t.isFunction(node) || isSetupCall(node)) {
    return null;
  }

  if (containsJsx(node)) {
    return "lazy";
  }

  if (!t.isIdentifier(node) && isMemberPath(node)) {
    return "alias";
  }

  return expressionReadsState(node, isReactiveIdentifier) ? "memo" : null;
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
  if (
    t.isCallExpression(expression) &&
    t.isIdentifier(expression.callee, { name: "__get" }) &&
    expression.arguments.length === 1 &&
    t.isIdentifier(expression.arguments[0])
  ) {
    used.text = true;
    return t.callExpression(t.identifier("__text"), [expression.arguments[0]]);
  }

  used.dynText = true;
  return t.callExpression(t.identifier("__dynText"), [t.arrowFunctionExpression([], expression)]);
}

function wrapAttrDynamic(expression: t.Expression, used: UsedHelpers): t.Expression {
  if (
    t.isCallExpression(expression) &&
    t.isIdentifier(expression.callee, { name: "__get" }) &&
    expression.arguments.length === 1 &&
    t.isIdentifier(expression.arguments[0])
  ) {
    used.attr = true;
    return t.callExpression(t.identifier("__attr"), [expression.arguments[0]]);
  }

  used.dynAttr = true;
  return t.callExpression(t.identifier("__dynAttr"), [t.arrowFunctionExpression([], expression)]);
}

function wrapBlockDynamic(expression: t.Expression, used: UsedHelpers): t.Expression {
  used.dynBlock = true;
  return t.callExpression(t.identifier("__dynBlock"), [t.arrowFunctionExpression([], expression)]);
}

function wrapBranchArm(arm: t.Expression, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  if (t.isJSXElement(arm) || t.isJSXFragment(arm) || !isDynamicExpression(arm)) {
    return arm;
  }

  return wrapReactiveChild(arm, used, analysis);
}

function wrapBranchDynamic(
  expression: t.ConditionalExpression,
  used: UsedHelpers,
  analysis?: ComponentAnalysis,
): t.Expression {
  used.branch = true;
  return t.callExpression(t.identifier("__branch"), [
    t.arrowFunctionExpression([], expression.test),
    t.arrowFunctionExpression([], wrapBranchArm(expression.consequent, used, analysis)),
    t.arrowFunctionExpression([], wrapBranchArm(expression.alternate, used, analysis)),
  ]);
}

function wrapReactiveChild(expression: t.Expression, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  if (keyedListCalls.has(expression)) {
    return expression;
  }

  if (!expressionProducesBlock(expression, analysis)) {
    return wrapTextDynamic(expression, used);
  }

  return t.isConditionalExpression(expression)
    ? wrapBranchDynamic(expression, used, analysis)
    : wrapBlockDynamic(expression, used);
}

function wrapNodeFactory(expression: t.Expression, used: UsedHelpers): t.Expression {
  used.node = true;
  return t.callExpression(t.identifier("__node"), [t.arrowFunctionExpression([], expression)]);
}

function wrapTemplateFactory(html: string, expression: t.Expression, used: UsedHelpers): t.Expression {
  used.tpl = true;
  return t.callExpression(t.identifier("__tpl"), [
    t.stringLiteral(html),
    t.arrowFunctionExpression([], expression),
  ]);
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
    JSXElement() {
      found = true;
    },

    JSXFragment() {
      found = true;
    },
  });

  return found;
}

function analyzeBlockFunctions(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
  derivedBindings: Map<string, DerivedInfo> = new Map(),
): Set<t.Identifier> {
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

        const derivedInfo = derivedBindings.get(path.node.name);
        const binding = path.scope.getBinding(path.node.name);
        if (derivedInfo?.returnsBlock && (!binding || binding.identifier === derivedInfo.bindingIdentifier)) {
          info.returnsBlock = true;
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

  return blockFunctions;
}

function expressionProducesBlock(node: t.Expression, analysis?: ComponentAnalysis): boolean {
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    return false;
  }

  const stack: t.Node[] = [node];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (t.isJSXElement(current) || t.isJSXFragment(current)) {
      return true;
    }

    if (t.isArrayExpression(current)) {
      return true;
    }

    if (t.isCallExpression(current)) {
      const callee = current.callee;

      if (t.isIdentifier(callee, { name: "__h" }) || t.isIdentifier(callee, { name: "__frag" }) || t.isIdentifier(callee, { name: "__tree" })) {
        return true;
      }

      const calleeName = getLooseIdentifierName(callee);
      if (calleeName && analysis?.blockFunctionNames.has(calleeName)) {
        return true;
      }

      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.property, { name: "map" }) &&
        current.arguments.some((argument) => {
          if (!t.isArrowFunctionExpression(argument) && !t.isFunctionExpression(argument)) {
            return false;
          }

          if (t.isBlockStatement(argument.body)) {
            return argument.body.body.some((statement) => {
              if (!t.isReturnStatement(statement) || !statement.argument) {
                return false;
              }

              return expressionProducesBlock(statement.argument, analysis);
            });
          }

          return expressionProducesBlock(argument.body, analysis);
        })
      ) {
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

// The rule of every other JSX compiler: whitespace with a line break in it is
// formatting and goes away, whitespace on a single line is content.
function normalizeJsxText(value: string): string {
  const lines = value.split(String.fromCharCode(10));
  const kept: string[] = [];

  lines.forEach((line, index) => {
    let text = line.replace(/\s+/g, " ");
    if (index > 0) {
      text = text.trimStart();
    }
    if (index < lines.length - 1) {
      text = text.trimEnd();
    }
    if (text) {
      kept.push(text);
    }
  });

  return kept.join(" ");
}

function escapeStaticHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeStaticAttribute(value: string): string {
  return escapeStaticHtml(value).replaceAll('"', "&quot;");
}

function staticAttributeValue(attribute: t.JSXAttribute): string | null {
  if (!t.isJSXIdentifier(attribute.name)) {
    return null;
  }

  const name = attribute.name.name;
  if (EVENT_PROP.test(name)) {
    return null;
  }

  if (attribute.value === null) {
    return "";
  }

  if (t.isStringLiteral(attribute.value)) {
    return escapeStaticAttribute(attribute.value.value);
  }

  if (!t.isJSXExpressionContainer(attribute.value) || t.isJSXEmptyExpression(attribute.value.expression)) {
    return null;
  }

  const expression = attribute.value.expression;
  if (t.isStringLiteral(expression)) {
    return escapeStaticAttribute(expression.value);
  }

  if (t.isNumericLiteral(expression)) {
    return String(expression.value);
  }

  if (t.isBooleanLiteral(expression)) {
    return expression.value ? "" : null;
  }

  return null;
}

// A template parses as HTML, so an SVG child on its own would lose its namespace.
function templateHtml(node: t.JSXElement | t.JSXFragment): string | null {
  if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name) && SVG_TAGS.has(node.openingElement.name.name) && node.openingElement.name.name !== "svg") {
    return null;
  }

  if (t.isJSXFragment(node) && node.children.some((child) => t.isJSXElement(child) && templateHtml(child) === null)) {
    return null;
  }

  return staticJsxHtml(node);
}

function staticJsxHtml(node: t.JSXElement | t.JSXFragment): string | null {
  if (t.isJSXFragment(node)) {
    const parts: string[] = [];

    for (const child of node.children) {
      const html = staticJsxChildHtml(child);
      if (html === null) {
        return null;
      }
      parts.push(html);
    }

    return parts.join("");
  }

  if (!t.isJSXIdentifier(node.openingElement.name) || isComponentName(node.openingElement.name.name)) {
    return null;
  }

  const tag = node.openingElement.name.name;
  const attrs: string[] = [];

  for (const attribute of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute)) {
      return null;
    }

    const value = staticAttributeValue(attribute);
    if (value === null) {
      return null;
    }

    const attrName = t.isJSXIdentifier(attribute.name) ? (STATIC_ATTRIBUTE_NAMES[attribute.name.name] ?? attribute.name.name) : "";
    attrs.push(value === "" ? ` ${attrName}=""` : ` ${attrName}="${value}"`);
  }

  // </br> would parse as a second line break.
  if (VOID_TAGS.has(tag)) {
    return `<${tag}${attrs.join("")}>`;
  }

  const children: string[] = [];
  for (const child of node.children) {
    const html = staticJsxChildHtml(child);
    if (html === null) {
      return null;
    }
    children.push(html);
  }

  return `<${tag}${attrs.join("")}>${children.join("")}</${tag}>`;
}

function staticJsxChildHtml(
  child: t.JSXText | t.JSXExpressionContainer | t.JSXElement | t.JSXFragment | t.JSXSpreadChild,
): string | null {
  if (t.isJSXText(child)) {
    return escapeStaticHtml(normalizeJsxText(child.value));
  }

  if (t.isJSXElement(child) || t.isJSXFragment(child)) {
    return staticJsxHtml(child);
  }

  if (t.isJSXSpreadChild(child)) {
    return null;
  }

  if (!t.isJSXExpressionContainer(child) || t.isJSXEmptyExpression(child.expression)) {
    return null;
  }

  const expression = child.expression;
  if (t.isStringLiteral(expression)) {
    return escapeStaticHtml(expression.value);
  }

  if (t.isNumericLiteral(expression)) {
    return String(expression.value);
  }

  if (t.isBooleanLiteral(expression) || t.isNullLiteral(expression)) {
    return "";
  }

  return null;
}

function buildJsxChildren(
  children: Array<t.JSXText | t.JSXExpressionContainer | t.JSXElement | t.JSXFragment | t.JSXSpreadChild>,
  used: UsedHelpers,
  analysis?: ComponentAnalysis,
): t.Expression[] {
  const output: t.Expression[] = [];

  for (const child of children) {
    if (t.isJSXText(child)) {
      const normalized = normalizeJsxText(child.value);
      if (normalized.length > 0) {
        output.push(t.stringLiteral(normalized));
      }
      continue;
    }

    if (t.isJSXSpreadChild(child)) {
      const normalized = normalizeExpression(child.expression, used, analysis);
      if (!isDynamicExpression(normalized)) {
        output.push(expressionProducesBlock(normalized, analysis) ? wrapNodeFactory(normalized, used) : normalized);
        continue;
      }

      output.push(expressionProducesBlock(normalized, analysis) ? wrapBlockDynamic(normalized, used) : wrapTextDynamic(normalized, used));
      continue;
    }

    if (t.isJSXElement(child)) {
      const built = buildJsxElement(child, used, analysis);
      const html = templateHtml(child);
      output.push(html ? wrapTemplateFactory(html, built, used) : wrapNodeFactory(built, used));
      continue;
    }

    if (t.isJSXFragment(child)) {
      const built = buildJsxFragment(child, used, analysis);
      const html = templateHtml(child);
      output.push(html ? wrapTemplateFactory(html, built, used) : wrapNodeFactory(built, used));
      continue;
    }

    if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      const normalized = normalizeExpression(child.expression, used, analysis);
      if (keyedListCalls.has(normalized)) {
        output.push(normalized);
        continue;
      }

      if (!isDynamicExpression(normalized)) {
        output.push(expressionProducesBlock(normalized, analysis) ? wrapNodeFactory(normalized, used) : normalized);
        continue;
      }

      output.push(wrapReactiveChild(normalized, used, analysis));
    }
  }

  return output;
}

function buildJsxProps(
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  used: UsedHelpers,
  analysis: ComponentAnalysis | undefined,
  isComponentTag: boolean,
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
      const expression = attribute.value.expression;
      const normalized = normalizeExpression(expression, used, analysis);
      if (isComponentTag && (t.isJSXElement(expression) || t.isJSXFragment(expression))) {
        value = wrapNodeFactory(normalized, used);
      } else {
        value = EVENT_PROP.test(name) || name === "ref" || !isDynamicExpression(normalized)
          ? normalized
          : wrapAttrDynamic(normalized, used);
      }
    } else {
      value = t.booleanLiteral(true);
    }

    properties.push(t.objectProperty(toObjectKey(name), value));
  }

  return t.objectExpression(properties);
}

type PlainTreeNode = string | number | PlainTreeElement;
type PlainTreeElement = [string, Record<string, string | number | true> | null, ...PlainTreeNode[]];

function hostTagOf(element: t.JSXElement): string | null {
  const { name } = element.openingElement;
  return t.isJSXIdentifier(name) && !isComponentName(name.name) ? name.name : null;
}

// Whether a host element can be part of a cloned tree. Nothing here may have side
// effects, so that the element can still be built the other way if the answer is no.
function canBeInTree(element: t.JSXElement): boolean {
  const tag = hostTagOf(element);

  if (!tag || RAW_TEXT_TAGS.has(tag) || tag === "foreignObject") {
    return false;
  }

  return element.openingElement.attributes.every((attribute) => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name));
}

function isTreeRoot(element: t.JSXElement): boolean {
  const tag = hostTagOf(element);

  // A template parses as HTML, so an SVG child on its own would lose its namespace.
  if (!tag || (SVG_TAGS.has(tag) && tag !== "svg")) {
    return false;
  }

  const fits = (current: t.JSXElement): boolean =>
    canBeInTree(current) && current.children.every((child) => !t.isJSXElement(child) || !hostTagOf(child) || fits(child));

  // With one element there is nothing to gain from cloning.
  return fits(element) && element.children.some((child) => t.isJSXElement(child) && hostTagOf(child) !== null);
}

function staticAttributeInTree(attribute: t.JSXAttribute): string | true | null {
  if (attribute.value === null) {
    return true;
  }

  if (t.isStringLiteral(attribute.value)) {
    return attribute.value.value;
  }

  if (t.isJSXExpressionContainer(attribute.value)) {
    const { expression } = attribute.value;
    if (t.isStringLiteral(expression)) return expression.value;
    if (t.isNumericLiteral(expression)) return String(expression.value);
    if (t.isBooleanLiteral(expression, { value: true })) return true;
  }

  return null;
}

function describeTreeElement(element: t.JSXElement, holes: t.Expression[], used: UsedHelpers, analysis?: ComponentAnalysis): PlainTreeElement {
  const tag = hostTagOf(element)!;
  let attrs: Record<string, string | number | true> | null = null;

  for (const attribute of element.openingElement.attributes as t.JSXAttribute[]) {
    const name = (attribute.name as t.JSXIdentifier).name;
    const value = EVENT_PROP.test(name) || name === "ref" || (name === "value" && tag === "select") ? null : staticAttributeInTree(attribute);

    attrs ??= {};

    if (value !== null) {
      attrs[name] = value;
      continue;
    }

    const built = buildJsxProps([attribute], used, analysis, false) as t.ObjectExpression;
    holes.push((built.properties[0] as t.ObjectProperty).value as t.Expression);
    attrs[name] = holes.length - 1;
  }

  const children: PlainTreeNode[] = [];
  const addText = (text: string): void => {
    const last = children[children.length - 1];
    if (typeof last === "string") {
      children[children.length - 1] = last + text;
    } else if (text) {
      children.push(text);
    }
  };

  for (const child of element.children) {
    if (t.isJSXText(child)) {
      addText(normalizeJsxText(child.value));
    } else if (t.isJSXElement(child) && hostTagOf(child)) {
      children.push(describeTreeElement(child, holes, used, analysis));
    } else if (t.isJSXExpressionContainer(child) && t.isStringLiteral(child.expression)) {
      addText(child.expression.value);
    } else if (t.isJSXExpressionContainer(child) && t.isNumericLiteral(child.expression)) {
      addText(String(child.expression.value));
    } else {
      for (const expression of buildJsxChildren([child], used, analysis)) {
        holes.push(expression);
        children.push(holes.length - 1);
      }
    }
  }

  return [tag, attrs, ...children];
}

function buildTree(element: t.JSXElement, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  const holes: t.Expression[] = [];
  const desc = describeTreeElement(element, holes, used, analysis);
  const key = JSON.stringify(desc);
  let id = used.trees.get(key);

  if (!id) {
    id = t.identifier(`__tree_${used.trees.size}`);
    used.trees.set(key, id);
  }

  used.tree = true;
  return t.callExpression(t.identifier("__tree"), [t.cloneNode(id), t.arrayExpression(holes)]);
}

function buildJsxElement(element: t.JSXElement, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  if (isTreeRoot(element)) {
    return buildTree(element, used, analysis);
  }

  used.h = true;

  const name = jsxNameToExpression(element.openingElement.name);

  return t.callExpression(t.identifier("__h"), [
    name,
    buildJsxProps(element.openingElement.attributes, used, analysis, !t.isStringLiteral(name)),
    ...buildJsxChildren(element.children, used, analysis),
  ]);
}

function buildJsxFragment(fragment: t.JSXFragment, used: UsedHelpers, analysis?: ComponentAnalysis): t.Expression {
  used.frag = true;

  return t.callExpression(t.identifier("__frag"), buildJsxChildren(fragment.children, used, analysis));
}

function replaceReactivePatternTargets<T extends t.Node>(
  node: T,
  replace: (identifier: t.Identifier) => t.MemberExpression | null,
): T | t.MemberExpression {
  const visit = <N extends t.Node>(child: N) => replaceReactivePatternTargets(child, replace) as N;

  if (t.isIdentifier(node)) {
    return replace(node) ?? node;
  }

  if (t.isArrayPattern(node)) {
    node.elements = node.elements.map((element) => element && visit(element));
  } else if (t.isObjectPattern(node)) {
    for (const property of node.properties) {
      if (t.isRestElement(property)) {
        property.argument = visit(property.argument);
      } else {
        property.shorthand = false;
        property.value = visit(property.value);
      }
    }
  } else if (t.isAssignmentPattern(node)) {
    node.left = visit(node.left);
  } else if (t.isRestElement(node)) {
    node.argument = visit(node.argument);
  }

  return node;
}

function formatLocation(node: t.Node): string {
  if (!node.loc?.start) {
    return "";
  }

  return `:${node.loc.start.line}:${node.loc.start.column + 1}`;
}

function compilerError(id: string, componentName: ComponentName, node: t.Node, message: string): never {
  throw new Error(`[hel] ${id}${formatLocation(node)} in ${componentName}: ${message}`);
}

function createPropAccessExpression(
  sourceExpression: t.Expression,
  property: t.ObjectProperty,
  id: string,
  componentName: ComponentName,
): { accessExpression: t.Expression; propertyName: string } {
  if (property.computed) {
    compilerError(id, componentName, property, "computed prop destructuring is not supported yet.");
  }

  const key = property.key;
  const keyExpression = t.isIdentifier(key)
    ? t.identifier(key.name)
    : t.isStringLiteral(key)
      ? t.stringLiteral(key.value)
      : t.isNumericLiteral(key)
        ? t.numericLiteral(key.value)
        : null;

  if (!keyExpression) {
    compilerError(id, componentName, property, "only identifier, string, or numeric prop destructuring keys are supported.");
  }

  const accessExpression = t.memberExpression(
    t.cloneNode(sourceExpression, true),
    keyExpression,
    !t.isIdentifier(keyExpression),
  );

  let propertyName: string;
  if (t.isIdentifier(key)) {
    propertyName = key.name;
  } else if (t.isStringLiteral(key)) {
    propertyName = key.value;
  } else if (t.isNumericLiteral(key)) {
    propertyName = String(key.value);
  } else {
    propertyName = "";
  }

  return { accessExpression, propertyName };
}

function collectPropDerivedBindings(
  pattern: t.ObjectPattern,
  sourceExpression: t.Expression,
  createFunctionIdentifier: () => t.Identifier,
  id: string,
  componentName: ComponentName,
): DerivedInfo[] {
  const output: DerivedInfo[] = [];

  for (const entry of pattern.properties) {
    if (!t.isObjectProperty(entry)) {
      compilerError(
        id,
        componentName,
        entry,
        "rest prop destructuring is not supported yet. Use explicit property picks for now.",
      );
    }

    const { accessExpression, propertyName } = createPropAccessExpression(
      sourceExpression,
      entry,
      id,
      componentName,
    );

    if (t.isIdentifier(entry.value)) {
      output.push({
        bindingIdentifier: entry.value,
        functionIdentifier: createFunctionIdentifier(),
        returnsBlock: propertyName === "children" || entry.value.name === "children",
        kind: "alias",
        factory: t.arrowFunctionExpression([], accessExpression),
      });
      continue;
    }

    if (t.isAssignmentPattern(entry.value) && t.isIdentifier(entry.value.left)) {
      const resolvedIdentifier = t.identifier("__value");
      output.push({
        bindingIdentifier: entry.value.left,
        functionIdentifier: createFunctionIdentifier(),
        returnsBlock: propertyName === "children" || entry.value.left.name === "children",
        kind: "alias",
        factory: t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.variableDeclaration("const", [
              t.variableDeclarator(resolvedIdentifier, accessExpression),
            ]),
            t.returnStatement(
              t.conditionalExpression(
                t.binaryExpression("===", resolvedIdentifier, t.identifier("undefined")),
                entry.value.right,
                resolvedIdentifier,
              ),
            ),
          ]),
        ),
      });
      continue;
    }

    if (t.isObjectPattern(entry.value)) {
      output.push(
        ...collectPropDerivedBindings(
          entry.value,
          accessExpression,
          createFunctionIdentifier,
          id,
          componentName,
        ),
      );
      continue;
    }

    if (t.isAssignmentPattern(entry.value) && t.isObjectPattern(entry.value.left)) {
      const defaultedAccess = t.callExpression(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.variableDeclaration("const", [
              t.variableDeclarator(t.identifier("__value"), accessExpression),
            ]),
            t.returnStatement(
              t.conditionalExpression(
                t.binaryExpression("===", t.identifier("__value"), t.identifier("undefined")),
                entry.value.right,
                t.identifier("__value"),
              ),
            ),
          ]),
        ),
        [],
      );

      output.push(
        ...collectPropDerivedBindings(
          entry.value.left,
          defaultedAccess,
          createFunctionIdentifier,
          id,
          componentName,
        ),
      );
      continue;
    }

    compilerError(
      id,
      componentName,
      entry.value,
      "nested prop destructuring only supports object patterns, aliases, and defaults for now.",
    );
  }

  return output;
}

function rewriteHookReturns(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
  readsState: (node: t.Node) => boolean,
  id: string,
  hookName: string,
): void {
  functionPath.traverse({
    Function(path: NodePath<t.Function>) {
      path.skip();
    },

    ReturnStatement(path: NodePath<t.ReturnStatement>) {
      const argument = path.node.argument ? stripTypeWrappers(path.node.argument) : null;

      if (t.isIdentifier(argument) && readsState(argument)) {
        compilerError(id, hookName, argument, "returning a reactive value directly would freeze it. Return an object or a function instead.");
      }

      if (t.isArrayExpression(argument) && argument.elements.some((element) => element && readsState(element))) {
        compilerError(id, hookName, argument, "returning reactive values in an array would freeze them. Return an object instead.");
      }

      if (!t.isObjectExpression(argument)) {
        return;
      }

      // A plain property would freeze the value at return time.
      argument.properties = argument.properties.map((property) => {
        if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value) || !readsState(property.value)) {
          return property;
        }

        return t.objectMethod(
          "get",
          t.cloneNode(property.key as t.Identifier),
          [],
          t.blockStatement([t.returnStatement(property.value)]),
        );
      });
    },
  });
}

function transformComponent(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
  used: UsedHelpers,
  id: string,
  componentName: ComponentName,
  kind: ReactiveScopeKind = "component",
): ComponentTransformResult {
  if (functionPath.node.async) {
    compilerError(
      id,
      componentName,
      functionPath.node,
      kind === "hook"
        ? "an async use* function returns a Promise, so its values cannot stay reactive. Load data with useResource() inside a normal use* function instead."
        : "an async component would render a Promise. Load data with useResource() instead.",
    );
  }

  const bodyPath = functionPath.get("body");
  if (!bodyPath.isBlockStatement()) {
    return {
      analysis: { blockFunctionNames: new Set<string>() },
      changed: false,
    };
  }

  const reactive = new Map<string, ReactiveInfo>();
  let changed = false;
  let cellCounter = 0;
  let derivedCounter = 0;
  const parameterPrelude: t.Statement[] = [];

  const derivedBindings = new Map<string, DerivedInfo>();

  const isReactiveIdentifier = (name: string, scope: NodePath["scope"]): boolean => {
    const bindingIdentifier = reactive.get(name)?.bindingIdentifier ?? derivedBindings.get(name)?.bindingIdentifier;
    return Boolean(bindingIdentifier && scope.getBinding(name)?.identifier === bindingIdentifier);
  };

  for (let index = 0; kind === "component" && index < functionPath.node.params.length; index += 1) {
    const parameter = functionPath.node.params[index]!;
    if (t.isIdentifier(parameter)) {
      continue;
    }

    if (t.isObjectPattern(parameter)) {
      const propsIdentifier = functionPath.scope.generateUidIdentifier("props");
      functionPath.node.params[index] = propsIdentifier;
      const derivedProps = collectPropDerivedBindings(
        parameter,
        t.identifier(propsIdentifier.name),
        () => t.identifier(`__prop_${derivedCounter++}`),
        id,
        componentName,
      );

      for (const derived of derivedProps) {
        derivedBindings.set(derived.bindingIdentifier.name, derived);
        parameterPrelude.push(
          t.variableDeclaration("const", [
            t.variableDeclarator(derived.functionIdentifier, derived.factory),
          ]),
        );
      }
      changed = true;
      continue;
    }

    compilerError(
      id,
      componentName,
      parameter,
      "component parameters other than a plain identifier are not supported yet. Accept props as a plain identifier and destructure inside the function body.",
    );
  }

  if (parameterPrelude.length > 0) {
    bodyPath.unshiftContainer("body", parameterPrelude);
  }

  for (const statementPath of bodyPath.get("body")) {
    if (!statementPath.isVariableDeclaration({ kind: "let" })) {
      continue;
    }

    for (const declaration of statementPath.node.declarations) {
      if (!t.isIdentifier(declaration.id)) {
        compilerError(
          id,
          componentName,
          declaration.id,
          "reactive let destructuring is not supported yet. Use a plain identifier and destructure inside a const or helper.",
        );
      }

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

  for (const statementPath of bodyPath.get("body")) {
    if (!statementPath.isVariableDeclaration({ kind: "const" })) {
      continue;
    }

    const replacements: t.Statement[] = [];
    const untouched: t.VariableDeclarator[] = [];

    for (const declarationPath of statementPath.get("declarations")) {
      const idPath = declarationPath.get("id");
      const init = declarationPath.node.init ? stripTypeWrappers(declarationPath.node.init) : null;

      if (!idPath.isObjectPattern() || !init || !(isMemberPath(init) || (isSetupCall(init) && t.isCallExpression(init) && t.isIdentifier(init.callee) && isHookName(init.callee.name)))) {
        untouched.push(declarationPath.node);
        continue;
      }

      let source: t.Expression = t.cloneNode(init, true, true);

      if (!isMemberPath(init)) {
        const hookResult = functionPath.scope.generateUidIdentifier("hook");
        replacements.push(t.variableDeclaration("const", [t.variableDeclarator(hookResult, init)]));
        source = t.identifier(hookResult.name);
      }

      const derivedProps = collectPropDerivedBindings(
        idPath.node,
        source,
        () => t.identifier(`__prop_${derivedCounter++}`),
        id,
        componentName,
      );

      for (const derived of derivedProps) {
        derivedBindings.set(derived.bindingIdentifier.name, derived);
        replacements.push(
          t.variableDeclaration("const", [
            t.variableDeclarator(derived.functionIdentifier, derived.factory),
          ]),
        );
      }
      changed = true;
    }

    if (untouched.length > 0) {
      replacements.unshift(t.variableDeclaration("const", untouched));
    }

    if (replacements.length === 1) {
      statementPath.replaceWith(replacements[0]);
    } else if (replacements.length > 1) {
      statementPath.replaceWithMultiple(replacements);
    }
  }

  const blockFunctions = analyzeBlockFunctions(functionPath);

  for (const statementPath of bodyPath.get("body")) {
    if (!statementPath.isVariableDeclaration({ kind: "const" })) {
      continue;
    }

    for (const declarationPath of statementPath.get("declarations")) {
      const idPath = declarationPath.get("id");
      const initPath = declarationPath.get("init");
      if (!idPath.isIdentifier() || !initPath.isExpression() || derivedBindings.has(idPath.node.name)) {
        continue;
      }

      const derivedKind = classifyConstInitializer(initPath.node, (name) =>
        isReactiveIdentifier(name, initPath.scope),
      );
      if (!derivedKind) {
        continue;
      }

      derivedBindings.set(idPath.node.name, {
        bindingIdentifier: idPath.node,
        functionIdentifier: t.identifier(`__derived_${idPath.node.name}_${derivedCounter++}`),
        returnsBlock:
          derivedKind === "lazy" ||
          expressionProducesBlock(initPath.node, {
            blockFunctionNames: new Set(Array.from(blockFunctions, (identifier) => identifier.name)),
          }),
        factory: t.arrowFunctionExpression([], initPath.node),
        kind: derivedKind,
      });
    }
  }

  for (const statementPath of bodyPath.get("body")) {
    if (!statementPath.isVariableDeclaration({ kind: "const" })) {
      continue;
    }

    const replacements: t.Statement[] = [];
    const untouched: t.VariableDeclarator[] = [];

    for (const declarationPath of statementPath.get("declarations")) {
      const idPath = declarationPath.get("id");
      const initPath = declarationPath.get("init");
      if (!idPath.isIdentifier() || !initPath.isExpression()) {
        untouched.push(declarationPath.node);
        continue;
      }

      const derived = derivedBindings.get(idPath.node.name);
      if (!derived || derived.bindingIdentifier !== idPath.node) {
        untouched.push(declarationPath.node);
        continue;
      }

      if (derived.kind !== "alias") {
        used.memo = true;
      }

      replacements.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(
            derived.functionIdentifier,
            derived.kind === "alias"
              ? derived.factory
              : t.callExpression(t.identifier("__memo"), [
                  derived.factory,
                  ...(derived.kind === "lazy" ? [t.booleanLiteral(true)] : []),
                ]),
          ),
        ]),
      );
      changed = true;
    }

    if (untouched.length > 0) {
      replacements.unshift(t.variableDeclaration("const", untouched));
    }

    if (replacements.length === 1) {
      statementPath.replaceWith(replacements[0]);
    } else if (replacements.length > 1) {
      statementPath.replaceWithMultiple(replacements);
    }
  }

  const finalBlockFunctions = analyzeBlockFunctions(functionPath, derivedBindings);

  if (kind === "hook") {
    rewriteHookReturns(
      functionPath,
      (node) => expressionReadsState(node, (name) => isReactiveIdentifier(name, bodyPath.scope)),
      id,
      componentName,
    );
    changed = true;
  }

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

  if (reactive.size === 0 && derivedBindings.size === 0) {
    return {
      analysis: {
        blockFunctionNames: new Set(Array.from(finalBlockFunctions, (identifier) => identifier.name)),
      },
      changed,
    };
  }

  const forcedBlockFunctionNames = new Set<string>();

  const rewriteVisitor: Visitor = {
    ForXStatement(path: NodePath<t.ForXStatement>) {
      const left = path.node.left;
      if (t.isVariableDeclaration(left)) {
        return;
      }

      const targetsReactive = Object.keys(t.getAssignmentIdentifiers(left)).some((name) =>
        shouldRewrite(name, path, reactive),
      );
      if (!targetsReactive) {
        return;
      }

      const item = path.scope.generateUidIdentifier("item");
      const assign = t.expressionStatement(t.assignmentExpression("=", left, t.cloneNode(item)));
      path.node.left = t.variableDeclaration("const", [t.variableDeclarator(item)]);
      path.node.body = t.isBlockStatement(path.node.body)
        ? t.blockStatement([assign, ...path.node.body.body])
        : t.blockStatement([assign, path.node.body]);
    },

    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      const leftPath = path.get("left");
      if (leftPath.isArrayPattern() || leftPath.isObjectPattern()) {
        const box = path.scope.generateUidIdentifier("targets");
        const writes: t.Statement[] = [];

        replaceReactivePatternTargets(leftPath.node, (identifier) => {
          const info = reactive.get(identifier.name);
          if (!info || !shouldRewrite(identifier.name, path, reactive)) {
            return null;
          }

          const slot = () => t.memberExpression(t.cloneNode(box), t.identifier(identifier.name));
          writes.push(
            t.expressionStatement(t.callExpression(t.identifier("__set"), [t.identifier(info.cellName), slot()])),
          );
          return slot();
        });

        if (writes.length === 0) {
          return;
        }

        // Writes go through a temporary object so the pattern keeps its normal
        // semantics. The value stays an argument so await and yield still work.
        const value = path.scope.generateUidIdentifier("value");
        used.set = true;
        changed = true;
        path.replaceWith(
          t.callExpression(
            t.arrowFunctionExpression(
              [t.cloneNode(value)],
              t.blockStatement([
                t.variableDeclaration("const", [t.variableDeclarator(box, t.objectExpression([]))]),
                t.expressionStatement(t.assignmentExpression("=", leftPath.node, t.cloneNode(value))),
                ...writes,
                t.returnStatement(t.cloneNode(value)),
              ]),
            ),
            [path.node.right],
          ),
        );
        return;
      }

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

      const binding = path.scope.getBinding(path.node.name);
      const derivedInfo = derivedBindings.get(path.node.name);
      if (derivedInfo && binding && binding.identifier === derivedInfo.bindingIdentifier) {
        if (derivedInfo.returnsBlock) {
          let currentFunction: NodePath<t.Node> | null = path.parentPath;

          while (currentFunction && !currentFunction.isFunction()) {
            currentFunction = currentFunction.parentPath;
          }

          if (currentFunction && currentFunction !== functionPath) {
            if (currentFunction.isFunctionDeclaration() && currentFunction.node.id) {
              forcedBlockFunctionNames.add(currentFunction.node.id.name);
            } else if (
              (currentFunction.isFunctionExpression() || currentFunction.isArrowFunctionExpression()) &&
              currentFunction.parentPath?.isVariableDeclarator() &&
              t.isIdentifier(currentFunction.parentPath.node.id)
            ) {
              forcedBlockFunctionNames.add(currentFunction.parentPath.node.id.name);
            }
          }
        }

        const parentPath = path.parentPath;

        if (
          parentPath.isObjectProperty() &&
          parentPath.node.shorthand &&
          parentPath.node.value === path.node
        ) {
          parentPath.replaceWith(
            t.objectProperty(parentPath.node.key, t.callExpression(t.identifier(derivedInfo.functionIdentifier.name), [])),
          );
          changed = true;
          path.skip();
          return;
        }

        path.replaceWith(t.callExpression(t.identifier(derivedInfo.functionIdentifier.name), []));
        changed = true;
        path.skip();
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
      blockFunctionNames: new Set([
        ...Array.from(finalBlockFunctions, (identifier) => identifier.name),
        ...Array.from(derivedBindings.values())
          .filter((entry) => entry.returnsBlock)
          .map((entry) => entry.functionIdentifier.name),
        ...Array.from(forcedBlockFunctionNames),
      ]),
    },
    changed,
  };
}

function injectRuntimeImport(ast: t.File, used: UsedHelpers): void {
  const requested: Array<{ imported: string; local: string; enabled: boolean }> = [
    { imported: "cell", local: "__cell", enabled: used.cell },
    { imported: "memo", local: "__memo", enabled: used.memo },
    { imported: "get", local: "__get", enabled: used.get },
    { imported: "set", local: "__set", enabled: used.set },
    { imported: "component", local: "__component", enabled: used.component },
    { imported: "h", local: "__h", enabled: used.h },
    { imported: "node", local: "__node", enabled: used.node },
    { imported: "text", local: "__text", enabled: used.text },
    { imported: "attr", local: "__attr", enabled: used.attr },
    { imported: "branch", local: "__branch", enabled: used.branch },
    { imported: "tpl", local: "__tpl", enabled: used.tpl },
    { imported: "row", local: "__row", enabled: used.row },
    { imported: "tree", local: "__tree", enabled: used.tree },
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

function shouldTransform(code: string, id: string): boolean {
  if (id.includes("node_modules")) {
    return false;
  }

  if (/\.[jt]sx$/.test(id)) {
    return true;
  }

  // Plain .ts files only matter for hooks. The framework's own sources define
  // functions like useContext and must stay untouched.
  return /\.ts$/.test(id) && !id.endsWith(".d.ts") && !id.includes("/src/framework/") && HOOK_DECLARATION.test(code);
}

export function helMagicPlugin(): Plugin {
  return {
    name: "hel-magic-plugin",
    enforce: "pre",
    transform(code, id) {
      if (!shouldTransform(code, id)) {
        return null;
      }

      const ast = parse(code, {
        sourceType: "module",
        plugins: id.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"],
      });

      const used = createUsedHelpers();
      let changed = false;
      const componentAnalyses = new WeakMap<t.Node, ComponentAnalysis>();
      const warnedModuleLets = new Set<string>();
      const warn = (message: string): void => {
        const context = this as unknown as { warn?: (message: string) => void } | undefined;
        if (typeof context?.warn === "function") {
          context.warn(message);
        } else {
          console.warn(message);
        }
      };

      traverse(ast, {
        CallExpression(path: NodePath<t.CallExpression>) {
          if (isRuntimeListCall(path)) {
            keyedListCalls.add(path.node);

            const render = (path.get("arguments") as NodePath[])[2];
            if (render?.isArrowFunctionExpression() || render?.isFunctionExpression()) {
              const live = makeRowLive(render as RowFunction, used, keyPropertyOf(path.node.arguments[1]));
              if (live) {
                path.node.arguments[2] = live;
                changed = true;
              }
            }
          }
        },

        JSXExpressionContainer(path: NodePath<t.JSXExpressionContainer>) {
          const owner = path.parentPath;
          if (!owner.isJSXElement() || !t.isJSXIdentifier(owner.node.openingElement.name)) {
            return;
          }

          if (!isRuntimeImport(owner, owner.node.openingElement.name.name, "For")) {
            return;
          }

          const render = path.get("expression");
          if (render.isArrowFunctionExpression() || render.isFunctionExpression()) {
            const keyAttribute = owner.node.openingElement.attributes.find(
              (attribute) => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: "key" }),
            ) as t.JSXAttribute | undefined;
            const keyValue = t.isJSXExpressionContainer(keyAttribute?.value) ? keyAttribute.value.expression : null;
            const live = makeRowLive(render as RowFunction, used, keyPropertyOf(keyValue));
            if (live) {
              keyedListCalls.add(live);
              path.node.expression = live;
              path.skip();
              changed = true;
            }
          }
        },

        Identifier(path: NodePath<t.Identifier>) {
          if (!path.isReferencedIdentifier() || warnedModuleLets.has(path.node.name)) {
            return;
          }

          const binding = path.scope.getBinding(path.node.name);
          if (
            binding?.kind === "let" &&
            binding.scope.path.isProgram() &&
            path.findParent((parent) => parent.isJSXExpressionContainer())
          ) {
            warnedModuleLets.add(path.node.name);
            warn(
              `[hel] ${id}${formatLocation(path.node)}: module-level let "${path.node.name}" is read in JSX but is not reactive. Use store() or a use* function instead.`,
            );
          }
        },
      });

      traverse(ast, {
        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          if (!path.node.id) {
            return;
          }

          if (isHookName(path.node.id.name)) {
            const result = transformComponent(path, used, id, path.node.id.name, "hook");
            componentAnalyses.set(path.node, result.analysis);
            changed = true;
            return;
          }

          if (!isComponentName(path.node.id.name)) {
            return;
          }

          const result = transformComponent(path, used, id, path.node.id.name);
          componentAnalyses.set(path.node, result.analysis);
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(t.identifier("__component"), [t.identifier(path.node.id.name)]),
            ),
          );
          used.component = true;
          changed = true;
        },

        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
          if (!t.isIdentifier(path.node.id) || !path.parentPath.isVariableDeclaration()) {
            return;
          }

          const name = path.node.id.name;
          const initPath = path.get("init");

          if (isHookName(name) && (initPath.isFunctionExpression() || initPath.isArrowFunctionExpression())) {
            const result = transformComponent(initPath, used, id, name, "hook");
            componentAnalyses.set(initPath.node, result.analysis);
            changed = true;
            return;
          }

          if (!isComponentName(name)) {
            return;
          }

          if (initPath.isFunctionExpression() || initPath.isArrowFunctionExpression()) {
            const result = transformComponent(initPath, used, id, name);
            componentAnalyses.set(initPath.node, result.analysis);
            path.get("init").replaceWith(
              t.callExpression(t.identifier("__component"), [path.node.init as t.Expression]),
            );
            used.component = true;
            changed = true;
            return;
          }

          // const Name = wrap(() => <div />)
          if (initPath.isCallExpression() && !isSetupCall(initPath.node)) {
            for (const argumentPath of initPath.get("arguments")) {
              if (
                (argumentPath.isFunctionExpression() || argumentPath.isArrowFunctionExpression()) &&
                containsJsx(argumentPath.node)
              ) {
                const node = argumentPath.node;
                const result = transformComponent(argumentPath, used, id, name);
                componentAnalyses.set(node, result.analysis);
                argumentPath.replaceWith(t.callExpression(t.identifier("__component"), [node]));
                used.component = true;
                changed = true;
              }
            }
          }
        },

        ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
          const declarationPath = path.get("declaration");
          const isAnonymous =
            declarationPath.isArrowFunctionExpression() ||
            declarationPath.isFunctionExpression() ||
            (declarationPath.isFunctionDeclaration() && !declarationPath.node.id);

          if (!isAnonymous || !containsJsx(declarationPath.node)) {
            return;
          }

          const node = declarationPath.node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
          const result = transformComponent(
            declarationPath as NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
            used,
            id,
            "default export",
          );
          componentAnalyses.set(node, result.analysis);
          declarationPath.replaceWith(
            t.callExpression(t.identifier("__component"), [t.toExpression(node) as t.Expression]),
          );
          used.component = true;
          changed = true;
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

      // The descriptions stay the same for every instance, so they live in the module.
      if (used.trees.size > 0) {
        const declarations = [...used.trees].map(([key, id]) =>
          t.variableDeclaration("const", [
            t.variableDeclarator(
              t.cloneNode(id),
              t.objectExpression([
                t.objectProperty(t.identifier("desc"), t.valueToNode(JSON.parse(key))),
                t.objectProperty(t.identifier("plan"), t.nullLiteral()),
              ]),
            ),
          ]),
        );
        const imports = ast.program.body.filter((statement) => t.isImportDeclaration(statement)).length;
        ast.program.body.splice(imports, 0, ...declarations);
      }

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
