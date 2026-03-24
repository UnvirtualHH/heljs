import { cell, dynAttr, dynBlock, get, set, untrack } from "./core";
import {
  buildRouteTarget,
  findRoute,
  matchRoutePath,
  mergeRouteQuery,
  normalizeRoutePath,
  parseRouteLocation,
  type QueryInput,
  type RouteDefinition,
  type RouterOptions,
} from "../shared";
import type { Dynamic } from "../shared";

export type BrowserRouter = {
  currentPath: () => string;
  params: () => Record<string, string>;
  query: () => Record<string, string>;
  href: (path: string, query?: QueryInput) => string;
  setQuery: (patch: QueryInput, options?: { replace?: boolean }) => void;
  navigate: (target: string | number, options?: { replace?: boolean }) => void;
  view: () => Dynamic<unknown>;
  isActive: (path: string) => Dynamic<boolean>;
};

type InstallableRouter = BrowserRouter & {
  routes: RouteDefinition[];
};

let activeRouterCleanup: (() => void) | null = null;

export function createBrowserRouter(
  routes: RouteDefinition[],
  options: RouterOptions = {},
  renderNotFound: (currentPath: string) => unknown,
): BrowserRouter {
  const initialLocation = parseRouteLocation(
    options.initialPath ??
      (typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/"),
  );
  const initialMatch = findRoute(routes, initialLocation.path);
  const path = cell(initialLocation.path);
  const params = cell<Record<string, string>>(initialMatch?.params ?? {});
  const query = cell<Record<string, string>>(initialLocation.query);

  const router: InstallableRouter = {
    routes,
    currentPath: () => get(path),
    params: () => get(params),
    query: () => get(query),
    href: (targetPath: string, nextQuery: QueryInput = {}) => buildRouteTarget(targetPath, nextQuery),
    setQuery: (patch: QueryInput, navOptions?: { replace?: boolean }) => {
      const currentPath = get(path);
      const nextQuery = mergeRouteQuery(get(query), patch);
      router.navigate(buildRouteTarget(currentPath, nextQuery), navOptions);
    },
    navigate: (target: string | number, navOptions?: { replace?: boolean }) => {
      if (typeof target === "number") {
        if (typeof window !== "undefined") {
          window.history.go(target);
        }
        return;
      }

      const nextLocation = parseRouteLocation(target);
      const nextMatch = findRoute(routes, nextLocation.path);

      if (typeof window !== "undefined") {
        const current = `${window.location.pathname}${window.location.search}`;
        const nextUrl = `${nextLocation.path}${new URLSearchParams(nextLocation.query).toString() ? `?${new URLSearchParams(nextLocation.query).toString()}` : ""}`;
        if (current !== nextUrl) {
          if (navOptions?.replace) {
            window.history.replaceState(null, "", nextUrl);
          } else {
            window.history.pushState(null, "", nextUrl);
          }
        }
      }

      set(path, nextLocation.path);
      set(params, nextMatch?.params ?? {});
      set(query, nextLocation.query);
    },
    view: () =>
      dynBlock(() => {
        const current = get(path);
        get(query);
        const match = findRoute(routes, current);
        if (match) {
          return untrack(() => match.route.view());
        }

        return untrack(() => renderNotFound(current));
      }),
    isActive: (targetPath: string) =>
      dynAttr(() => Boolean(matchRoutePath(targetPath, get(path)))),
  };

  installRouterEvents(router);
  return router;
}

function installRouterEvents(router: InstallableRouter): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  activeRouterCleanup?.();

  const onClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const anchor = target instanceof HTMLAnchorElement
      ? target
      : target.parentElement?.closest("a[href]");

    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || anchor.hasAttribute("download")) {
      return;
    }

    if (anchor.target && anchor.target !== "_self") {
      return;
    }

    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      return;
    }

    if (!findRoute(router.routes, url.pathname)) {
      return;
    }

    event.preventDefault();
    router.navigate(url.pathname + url.search + url.hash);
  };

  const onPopState = () => {
    router.navigate(`${window.location.pathname}${window.location.search}`, { replace: true });
  };

  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPopState);

  activeRouterCleanup = () => {
    document.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPopState);
    activeRouterCleanup = null;
  };
}
