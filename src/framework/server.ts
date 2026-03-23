type DynamicKind = "text" | "attr" | "block";

type Renderable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Dynamic
  | NodeFactory
  | Renderable[]
  | ServerElement
  | ServerFragment;

type NodeFactory<T = unknown> = {
  [NODE_FACTORY]: true;
  read: () => T;
};

type Dynamic<T = unknown> = {
  [DYNAMIC]: true;
  kind: DynamicKind;
  read: () => T;
};

type ServerElement = {
  type: "element";
  tag: string;
  props: Record<string, unknown> | null;
  children: Renderable[];
};

type ServerFragment = {
  type: "fragment";
  children: Renderable[];
};

const BLOCK_START = "hs:block:start";
const BLOCK_END = "hs:block:end";
const DYNAMIC = Symbol("hel.dynamic");
const NODE_FACTORY = Symbol("hel.node-factory");
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

export interface Cell<T> {
  value: T;
  subscribers: Set<never>;
}

export function cell<T>(value: T): Cell<T> {
  return {
    value,
    subscribers: new Set<never>(),
  };
}

export function get<T>(slot: Cell<T>): T {
  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
  slot.value = next;
  return next;
}

export function effect(fn: () => void): () => void {
  fn();
  return () => undefined;
}

export function node<T>(read: () => T): NodeFactory<T> {
  return {
    [NODE_FACTORY]: true,
    read,
  };
}

function createDynamic<T>(kind: DynamicKind, read: () => T): Dynamic<T> {
  return {
    [DYNAMIC]: true,
    kind,
    read,
  };
}

export function dynText<T>(read: () => T): Dynamic<T> {
  return createDynamic("text", read);
}

export function dynAttr<T>(read: () => T): Dynamic<T> {
  return createDynamic("attr", read);
}

export function dynBlock<T>(read: () => T): Dynamic<T> {
  return createDynamic("block", read);
}

export function dyn<T>(read: () => T): Dynamic<T> {
  return dynBlock(read);
}

function isDynamic(value: unknown): value is Dynamic {
  return typeof value === "object" && value !== null && DYNAMIC in value;
}

function isNodeFactory(value: unknown): value is NodeFactory {
  return typeof value === "object" && value !== null && NODE_FACTORY in value;
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
  if (!isDynamic(value)) {
    return value;
  }

  if (value.kind === "block") {
    return null;
  }

  return resolveAttrValue(value.read());
}

function serializeProps(props: Record<string, unknown> | null): string {
  if (!props) {
    return "";
  }

  const attributes: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(props)) {
    if (rawKey === "children" || rawKey.startsWith("on")) {
      continue;
    }

    const normalizedKey = rawKey === "className" ? "class" : rawKey;
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

function serializeValue(value: unknown): string {
  if (isNodeFactory(value)) {
    return serializeValue(value.read());
  }

  if (isDynamic(value)) {
    if (value.kind === "attr") {
      return "";
    }

    if (value.kind === "block") {
      return `<!--${BLOCK_START}-->${serializeValue(value.read())}<!--${BLOCK_END}-->`;
    }

    return escapeHtml(normalizeTextValue(value.read()));
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).join("");
  }

  if (isServerFragment(value)) {
    return value.children.map((entry) => serializeValue(entry)).join("");
  }

  if (isServerElement(value)) {
    const open = `<${value.tag}${serializeProps(value.props)}>`;
    if (VOID_TAGS.has(value.tag)) {
      return open;
    }

    const children = value.children.map((entry) => serializeValue(entry)).join("");
    return `${open}${children}</${value.tag}>`;
  }

  if (value == null || value === false || value === true) {
    return "";
  }

  return escapeHtml(String(value));
}

export function h(
  tag: string | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null,
  ...children: Renderable[]
): Renderable {
  if (typeof tag === "function") {
    return tag({ ...(props ?? {}), children }) as Renderable;
  }

  return {
    type: "element",
    tag,
    props,
    children,
  };
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
