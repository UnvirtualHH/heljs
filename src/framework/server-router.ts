import {
  findRoute,
  matchRoutePath,
  normalizeRoutePath,
  parseRouteLocation,
  type RouteDefinition,
  type RouterOptions,
} from "./shared";

export type StaticRouter = {
  currentPath: () => string;
  params: () => Record<string, string>;
  query: () => Record<string, string>;
  navigate: (target: string | number, options?: { replace?: boolean }) => void;
  view: () => unknown;
  isActive: (path: string) => boolean;
};

export function createStaticRouter(
  routes: RouteDefinition[],
  options: RouterOptions = {},
  renderNotFound: (currentPath: string) => unknown,
): StaticRouter {
  const initialLocation = parseRouteLocation(options.initialPath ?? "/");
  let currentPath = normalizeRoutePath(initialLocation.path);
  let currentParams = findRoute(routes, currentPath)?.params ?? {};
  let currentQuery = initialLocation.query;

  return {
    currentPath: () => currentPath,
    params: () => currentParams,
    query: () => currentQuery,
    navigate: (target: string | number) => {
      if (typeof target === "number") {
        return;
      }
      const nextLocation = parseRouteLocation(target);
      currentPath = normalizeRoutePath(nextLocation.path);
      currentParams = findRoute(routes, currentPath)?.params ?? {};
      currentQuery = nextLocation.query;
    },
    view: () => {
      const match = findRoute(routes, currentPath);
      if (match) {
        return match.route.view();
      }

      return renderNotFound(currentPath);
    },
    isActive: (path: string) => Boolean(matchRoutePath(path, currentPath)),
  };
}
