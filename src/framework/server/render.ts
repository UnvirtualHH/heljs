import {
  component,
  dynBlock,
  get,
  node,
  isAttrBinding,
  isBranchBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
  runWithContext,
  type Cell,
} from "./core";
import {
  BLOCK_END,
  BLOCK_START,
  BOUNDARY_FAILED,
  COMPONENT_REACTIVE_PROPS,
  CONTEXT_PROVIDER,
  isThenable,
  RENDERED_PROMISE_MESSAGE,
  renderRowOnce,
  renderTree,
  type ErrorBoundaryProps,
  type TreeDefinition,
} from "../shared";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export type ServerElement = {
  type: "element";
  tag: string;
  props: Record<string, unknown> | null;
  children: Renderable[];
};

export type ServerFragment = {
  type: "fragment";
  children: Renderable[];
};

export type ServerHtml = {
  type: "html";
  html: string;
};

export type Renderable =
  | string
  | number
  | boolean
  | null
  | undefined
  | import("../shared").BranchBinding<any>
  | import("../shared").Dynamic
  | import("../shared").KeyedList<any>
  | import("../shared").TextBinding<any>
  | import("../shared").AttrBinding<any>
  | import("../shared").TemplateFactory<any>
  | import("../shared").NodeFactory
  | Renderable[]
  | ServerElement
  | ServerFragment
  | ServerHtml;

function isContextProvider(tag: unknown): tag is ((props: any) => unknown) & { [CONTEXT_PROVIDER]: import("../shared").ContextDefinition<unknown> } {
  return Boolean(tag && typeof tag === "function" && (tag as unknown as Record<PropertyKey, unknown>)[CONTEXT_PROVIDER]);
}

// Nested JSX renders lazily, so a provider subtree has to be serialized while
// the provider's context frame is still active.
function renderContextChildren(children: Renderable[]): Renderable {
  return {
    type: "html",
    html: serializeValue(children),
  };
}

function resolvePropValue(value: unknown): unknown {
  if (isDynamic(value) || isNodeFactory(value) || isTemplateFactory(value)) {
    return value.read();
  }

  if (isTextBinding(value) || isAttrBinding(value)) {
    return get(value.cell as Cell<unknown>);
  }

  return value;
}

function createComponentPropsView(
  props: Record<string, unknown> | null,
  children: unknown[],
): Record<string, unknown> {
  const view: Record<string, unknown> = {};

  for (const [key, value] of Object.entries({ ...(props ?? {}), children })) {
    Object.defineProperty(view, key, {
      enumerable: true,
      configurable: false,
      get: () => resolvePropValue(value),
    });
  }

  return view;
}

function isServerHtml(value: unknown): value is ServerHtml {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "html";
}

function isServerElement(value: unknown): value is ServerElement {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element";
}

function isServerFragment(value: unknown): value is ServerFragment {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "fragment";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function normalizeTextValue(value: unknown): string {
  if (value == null || value === false || value === true) {
    return "";
  }

  return String(value);
}

function toStyleString(value: unknown): string {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const parts: string[] = [];

  for (const [key, entry] of entries) {
    if (entry == null || entry === false) {
      continue;
    }

    const cssKey = key.replace(/[A-Z]/g, (segment) => `-${segment.toLowerCase()}`);
    parts.push(`${cssKey}:${String(entry)}`);
  }

  return parts.join(";");
}

function resolveAttrValue(value: unknown): unknown {
  if (isAttrBinding(value)) {
    return get(value.cell as Cell<any>);
  }

  if (!isDynamic(value)) {
    return value;
  }

  if (value.kind === "block") {
    return null;
  }

  return resolveAttrValue(value.read());
}

// A <select> takes its value from a selected option, a <textarea> from its content.
const VALUE_IN_CONTENT = new Set(["select", "textarea"]);
const ATTRIBUTE_NAMES: Record<string, string> = { className: "class", htmlFor: "for" };

let selectValue: string | undefined;

function serializeProps(props: Record<string, unknown> | null, tag: string): string {
  if (!props) {
    return "";
  }

  const attributes: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(props)) {
    if (rawKey === "children" || rawKey === "ref" || rawKey.startsWith("on") || (rawKey === "value" && VALUE_IN_CONTENT.has(tag))) {
      continue;
    }

    const normalizedKey = ATTRIBUTE_NAMES[rawKey] ?? rawKey;
    const resolved = resolveAttrValue(rawValue);

    if (resolved == null || resolved === false) {
      continue;
    }

    if (resolved === true) {
      attributes.push(` ${normalizedKey}=""`);
      continue;
    }

    const value = normalizedKey === "style" ? toStyleString(resolved) : String(resolved);
    attributes.push(` ${normalizedKey}="${escapeAttribute(value)}"`);
  }

  return attributes.join("");
}

// The client turns a text slot holding an object into a block slot.
function serializeText(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return `<!--${BLOCK_START}-->${serializeValue(value)}<!--${BLOCK_END}-->`;
  }

  return escapeHtml(normalizeTextValue(value));
}

function serializeValue(value: unknown): string {
  if (isNodeFactory(value)) {
    return serializeValue(value.read());
  }

  if (isTextBinding(value)) {
    return serializeText(get(value.cell as Cell<any>));
  }

  if (isAttrBinding(value)) {
    return "";
  }

  if (isTemplateFactory(value)) {
    return serializeValue(value.read());
  }

  if (isBranchBinding(value)) {
    return `<!--${BLOCK_START}-->${serializeValue(value.when() ? value.consequent() : value.alternate())}<!--${BLOCK_END}-->`;
  }

  if (isDynamic(value)) {
    if (value.kind === "attr") {
      return "";
    }

    if (value.kind === "block") {
      return `<!--${BLOCK_START}-->${serializeValue(value.read())}<!--${BLOCK_END}-->`;
    }

    return serializeText(value.read());
  }

  if (isKeyedList(value)) {
    return `<!--${BLOCK_START}-->${value.read().map((item, index) => serializeValue(renderRowOnce(value.render, item, index, value.key(item, index)))).join("")}<!--${BLOCK_END}-->`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).join("");
  }

  if (isServerFragment(value)) {
    return value.children.map((entry) => serializeValue(entry)).join("");
  }

  if (isServerHtml(value)) {
    return value.html;
  }

  if (isServerElement(value)) {
    return serializeElement(value);
  }

  if (value == null || value === false || value === true) {
    return "";
  }

  if (isThenable(value)) {
    throw new Error(RENDERED_PROMISE_MESSAGE);
  }

  return escapeHtml(String(value));
}

function serializeElement(element: ServerElement): string {
  const { tag, props } = element;
  const value = props && VALUE_IN_CONTENT.has(tag) ? resolveAttrValue(props.value) : undefined;
  const selected = tag === "option" && selectValue !== undefined && String(resolveAttrValue(props?.value)) === selectValue;
  const open = `<${tag}${serializeProps(props, tag)}${selected ? " selected" : ""}>`;

  if (VOID_TAGS.has(tag)) {
    return open;
  }

  if (tag === "textarea" && value != null) {
    return `${open}${escapeHtml(String(value))}</${tag}>`;
  }

  const previousSelectValue = selectValue;
  if (tag === "select") {
    selectValue = value == null ? undefined : String(value);
  }

  try {
    return `${open}${element.children.map((entry) => serializeValue(entry)).join("")}</${tag}>`;
  } finally {
    selectValue = previousSelectValue;
  }
}

function hasReactiveProps(props: Record<string, unknown> | null): boolean {
  return Object.values(props ?? {}).some(
    (value) => isDynamic(value) || isAttrBinding(value) || isTextBinding(value) || isNodeFactory(value) || isTemplateFactory(value),
  );
}

export function h(
  tag: string | ((props: any) => unknown),
  props: Record<string, unknown> | null,
  ...children: any[]
): Renderable {
  if (typeof tag === "function") {
    // Where the client re-renders through a block, its markers have to exist here too.
    if (isContextProvider(tag)) {
      const context = tag[CONTEXT_PROVIDER];
      const renderProvider = () => runWithContext(context, props?.value, () => renderContextChildren(children as Renderable[]));
      return hasReactiveProps(props) ? dynBlock(renderProvider) : renderProvider();
    }

    const render = () => tag(createComponentPropsView(props, children)) as Renderable;
    const managesOwnProps = (tag as unknown as Record<PropertyKey, unknown>)[COMPONENT_REACTIVE_PROPS] === true;
    return hasReactiveProps(props) && !managesOwnProps ? dynBlock(render) : render();
  }

  return {
    type: "element",
    tag,
    props,
    children,
  };
}

export const ErrorBoundary = component((rawProps: Record<string, unknown>): any => {
  const props = rawProps as ErrorBoundaryProps;
  let html: string;

  try {
    html = serializeValue(props.children ?? []);
  } catch (error) {
    // Nobody sees this in a browser, so the server log is the only trace of it.
    console.error(error);
    const { fallback } = props;
    const content = typeof fallback === "function" ? fallback(error, () => undefined) : fallback;
    html = `<!--${BOUNDARY_FAILED}-->${serializeValue(content)}`;
  }

  return {
    type: "html",
    html: `<!--${BLOCK_START}-->${html}<!--${BLOCK_END}-->`,
  };
});

const UNSAFE_IN_SCRIPT = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");

// Data ends up inside a <script>, where a plain JSON.stringify lets a value such
// as "</script>" break out of it.
export function serializeData(value: unknown): string {
  return (JSON.stringify(value) ?? "undefined").replace(
    UNSAFE_IN_SCRIPT,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function tree(definition: TreeDefinition, values: unknown[]): Renderable {
  return renderTree(definition.desc, values, h as never, node) as Renderable;
}

export function frag(...children: Renderable[]): Renderable {
  return {
    type: "fragment",
    children,
  };
}

export function renderToString(factory: () => unknown): string {
  return serializeValue(factory());
}
