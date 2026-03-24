export type DynamicKind = "text" | "attr" | "block";

export const BLOCK_START = "hs:block:start";
export const BLOCK_END = "hs:block:end";
export const DYNAMIC = Symbol("hel.dynamic");
export const LIST = Symbol("hel.list");
export const NODE_FACTORY = Symbol("hel.node-factory");
export const TEXT_BINDING = Symbol("hel.text-binding");
export const ATTR_BINDING = Symbol("hel.attr-binding");
export const TEMPLATE_FACTORY = Symbol("hel.template-factory");

export type NodeFactory<T = unknown> = {
  [NODE_FACTORY]: true;
  read: () => T;
};

export type TextBinding<T = unknown> = {
  [TEXT_BINDING]: true;
  cell: { value: T };
};

export type AttrBinding<T = unknown> = {
  [ATTR_BINDING]: true;
  cell: { value: T };
};

export type TemplateFactory<T = unknown> = {
  [TEMPLATE_FACTORY]: true;
  html: string;
  read: () => T;
};

export type KeyedList<T> = {
  [LIST]: true;
  read: () => T[];
  key: (item: T, index: number) => string | number;
  render: (item: T, index: number) => unknown;
};

export type Dynamic<T = unknown> = {
  [DYNAMIC]: true;
  kind: DynamicKind;
  read: () => T;
};

export type ForProps<T> = {
  each: T[];
  key?: (item: T, index: number) => string | number;
  fallback?: unknown;
  children?: Array<((item: T, index: number) => unknown) | unknown>;
};

export type ShowProps = {
  when: unknown;
  fallback?: unknown;
  children?: unknown[];
};

export type RouteDefinition = {
  path: string;
  view: () => unknown;
};

export type RouteMatch = {
  route: RouteDefinition;
  params: Record<string, string>;
};

export type RouterOptions = {
  initialPath?: string;
};

export function isDynamic(value: unknown): value is Dynamic {
  return typeof value === "object" && value !== null && DYNAMIC in value;
}

export function isNodeFactory(value: unknown): value is NodeFactory {
  return typeof value === "object" && value !== null && NODE_FACTORY in value;
}

export function isTextBinding(value: unknown): value is TextBinding {
  return typeof value === "object" && value !== null && TEXT_BINDING in value;
}

export function isAttrBinding(value: unknown): value is AttrBinding {
  return typeof value === "object" && value !== null && ATTR_BINDING in value;
}

export function isTemplateFactory(value: unknown): value is TemplateFactory {
  return typeof value === "object" && value !== null && TEMPLATE_FACTORY in value;
}

export function isKeyedList(value: unknown): value is KeyedList<unknown> {
  return typeof value === "object" && value !== null && LIST in value;
}

export function normalizeRoutePath(path: string): string {
  if (!path) {
    return "/";
  }

  try {
    if (typeof window !== "undefined") {
      const url = new URL(path, window.location.origin);
      return url.pathname || "/";
    }
  } catch {
    // fall through to plain normalization
  }

  return path.startsWith("/") ? path : `/${path.replace(/^\/+/, "")}`;
}

export function splitRoutePath(path: string): string[] {
  const normalized = normalizeRoutePath(path)
    .replace(/\/+$/, "")
    .replace(/^\/+/, "");

  return normalized ? normalized.split("/") : [];
}

export function matchRoutePath(routePath: string, path: string): Record<string, string> | null {
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

export function findRoute(routes: RouteDefinition[], path: string): RouteMatch | null {
  const normalized = normalizeRoutePath(path);

  for (const route of routes) {
    const params = matchRoutePath(route.path, normalized);
    if (params) {
      return { route, params };
    }
  }

  return null;
}
