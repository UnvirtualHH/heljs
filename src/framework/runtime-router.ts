import { cell, dynAttr, dynBlock, get, set, untrack } from "./runtime-core";
import {
  findRoute,
  matchRoutePath,
  normalizeRoutePath,
  type RouteDefinition,
  type RouterOptions,
} from "./shared";
import type { Dynamic } from "./shared";

export type BrowserRouter = {
  currentPath: () => string;
  params: () => Record<string, string>;
  navigate: (path: string, options?: { replace?: boolean }) => void;
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
  const initialPath = normalizeRoutePath(
    options.initialPath ?? (typeof window !== "undefined" ? window.location.pathname : "/"),
  );
  const initialMatch = findRoute(routes, initialPath);
  const path = cell(initialPath);
  const params = cell<Record<string, string>>(initialMatch?.params ?? {});

  const router: InstallableRouter = {
    routes,
    currentPath: () => get(path),
    params: () => get(params),
    navigate: (nextPath: string, navOptions?: { replace?: boolean }) => {
      const normalized = normalizeRoutePath(nextPath);
      const nextMatch = findRoute(routes, normalized);

      if (typeof window !== "undefined") {
        const current = normalizeRoutePath(window.location.pathname);
        if (current !== normalized) {
          if (navOptions?.replace) {
            window.history.replaceState(null, "", normalized);
          } else {
            window.history.pushState(null, "", normalized);
          }
        }
      }

      set(path, normalized);
      set(params, nextMatch?.params ?? {});
    },
    view: () =>
      dynBlock(() => {
        const current = get(path);
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
    router.navigate(window.location.pathname, { replace: true });
  };

  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPopState);

  activeRouterCleanup = () => {
    document.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPopState);
    activeRouterCleanup = null;
  };
}
