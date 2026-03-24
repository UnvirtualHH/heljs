type DynamicKind = "text" | "attr" | "block";

type KeyedList<T> = {
  [LIST]: true;
  read: () => T[];
  key: (item: T, index: number) => string | number;
  render: (item: T, index: number) => unknown;
};

type ForProps<T> = {
  each: T[];
  key?: (item: T, index: number) => string | number;
  fallback?: unknown;
  children?: Array<((item: T, index: number) => unknown) | unknown>;
};

type ShowProps = {
  when: unknown;
  fallback?: unknown;
  children?: unknown[];
};

type RouteDefinition = {
  path: string;
  view: () => unknown;
};

type RouteMatch = {
  route: RouteDefinition;
  params: Record<string, string>;
};

type RouterOptions = {
  initialPath?: string;
};

export type Router = {
  currentPath: () => string;
  params: () => Record<string, string>;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  view: () => unknown;
  isActive: (path: string) => boolean;
};

type TextBinding<T = unknown> = {
  [TEXT_BINDING]: true;
  cell: Cell<T>;
};

type AttrBinding<T = unknown> = {
  [ATTR_BINDING]: true;
  cell: Cell<T>;
};

type TemplateFactory<T = unknown> = {
  [TEMPLATE_FACTORY]: true;
  html: string;
  read: () => T;
};

type Renderable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Dynamic
  | KeyedList<any>
  | TextBinding<any>
  | AttrBinding<any>
  | TemplateFactory<any>
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
const LIST = Symbol("hel.list");
const NODE_FACTORY = Symbol("hel.node-factory");
const TEXT_BINDING = Symbol("hel.text-binding");
const ATTR_BINDING = Symbol("hel.attr-binding");
const TEMPLATE_FACTORY = Symbol("hel.template-factory");
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

export function store<T extends object>(value: T): T {
  return value;
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

export function text<T>(cell: Cell<T>): TextBinding<T> {
  return {
    [TEXT_BINDING]: true,
    cell,
  };
}

export function attr<T>(cell: Cell<T>): AttrBinding<T> {
  return {
    [ATTR_BINDING]: true,
    cell,
  };
}

export function tpl<T>(html: string, read: () => T): TemplateFactory<T> {
  return {
    [TEMPLATE_FACTORY]: true,
    html,
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

export function list<T>(
  read: () => T[],
  key: (item: T, index: number) => string | number,
  render: (item: T, index: number) => unknown,
): KeyedList<T> {
  return {
    [LIST]: true,
    read,
    key,
    render,
  };
}

function unwrapControlFlowValue<T>(value: T): T {
  if (isDynamic(value)) {
    return value.read() as T;
  }

  if (isTextBinding(value)) {
    return get(value.cell) as T;
  }

  if (isAttrBinding(value)) {
    return get(value.cell) as T;
  }

  if (isNodeFactory(value)) {
    return value.read() as T;
  }

  if (isTemplateFactory(value)) {
    return value.read() as T;
  }

  return value;
}

export function For<T>(rawProps: Record<string, unknown>): any {
  const props = rawProps as ForProps<T>;
  const items = (unwrapControlFlowValue(props.each) ?? []) as T[];
  const render = props.children?.[0];

  if (items.length === 0) {
    return unwrapControlFlowValue(props.fallback) ?? null;
  }

  if (typeof render !== "function") {
    return items;
  }

  const renderItem = render as (item: T, index: number) => unknown;

  if (!props.key) {
    return items.map((item, index) => renderItem(item, index));
  }

  return list(
    () => items,
    props.key,
    renderItem,
  );
}

export function Show(rawProps: Record<string, unknown>): any {
  const props = rawProps as ShowProps;
  return unwrapControlFlowValue(props.when) ? props.children ?? null : unwrapControlFlowValue(props.fallback) ?? null;
}

function normalizeRoutePath(path: string): string {
  if (!path) {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path.replace(/^\/+/, "")}`;
}

function splitRoutePath(path: string): string[] {
  const normalized = normalizeRoutePath(path)
    .replace(/\/+$/, "")
    .replace(/^\/+/, "");

  return normalized ? normalized.split("/") : [];
}

function matchRoutePath(routePath: string, path: string): Record<string, string> | null {
  const routeSegments = splitRoutePath(routePath);
  const pathSegments = splitRoutePath(path);

  if (routeSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index]!;
    const pathSegment = pathSegments[index]!;

    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }

    if (routeSegment !== pathSegment) {
      return null;
    }
  }

  return params;
}

function findRoute(routes: RouteDefinition[], path: string): RouteMatch | null {
  const normalized = normalizeRoutePath(path);

  for (const route of routes) {
    const params = matchRoutePath(route.path, normalized);
    if (params) {
      return { route, params };
    }
  }

  return null;
}

export function createRouter(routes: RouteDefinition[], options: RouterOptions = {}): Router {
  let currentPath = normalizeRoutePath(options.initialPath ?? "/");
  let currentParams = findRoute(routes, currentPath)?.params ?? {};

  return {
    currentPath: () => currentPath,
    params: () => currentParams,
    navigate: (nextPath: string) => {
      currentPath = normalizeRoutePath(nextPath);
      currentParams = findRoute(routes, currentPath)?.params ?? {};
    },
    view: () => {
      const match = findRoute(routes, currentPath);
      if (match) {
        return match.route.view();
      }

      return h(
        "section",
        { class: "route-miss" },
        h("h2", null, "Not found"),
        h("p", null, `No route matched ${currentPath}.`),
      );
    },
    isActive: (path: string) => Boolean(matchRoutePath(path, currentPath)),
  };
}

export function Link(
  props: Record<string, unknown> | null,
  ...children: any[]
): Renderable {
  return h("a", props, ...children);
}

function isDynamic(value: unknown): value is Dynamic {
  return typeof value === "object" && value !== null && DYNAMIC in value;
}

function isNodeFactory(value: unknown): value is NodeFactory {
  return typeof value === "object" && value !== null && NODE_FACTORY in value;
}

function isTextBinding(value: unknown): value is TextBinding {
  return typeof value === "object" && value !== null && TEXT_BINDING in value;
}

function isAttrBinding(value: unknown): value is AttrBinding {
  return typeof value === "object" && value !== null && ATTR_BINDING in value;
}

function isTemplateFactory(value: unknown): value is TemplateFactory {
  return typeof value === "object" && value !== null && TEMPLATE_FACTORY in value;
}

function isKeyedList(value: unknown): value is KeyedList<unknown> {
  return typeof value === "object" && value !== null && LIST in value;
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
    return get(value.cell);
  }

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

  if (isTextBinding(value)) {
    return escapeHtml(normalizeTextValue(get(value.cell)));
  }

  if (isAttrBinding(value)) {
    return "";
  }

  if (isTemplateFactory(value)) {
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

  if (isKeyedList(value)) {
    return `<!--${BLOCK_START}-->${value.read().map((item, index) => serializeValue(value.render(item, index))).join("")}<!--${BLOCK_END}-->`;
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
  tag: string | ((props: any) => unknown),
  props: Record<string, unknown> | null,
  ...children: any[]
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
