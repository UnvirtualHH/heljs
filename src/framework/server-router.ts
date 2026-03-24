import {
  findRoute,
  matchRoutePath,
  normalizeRoutePath,
  type RouteDefinition,
  type RouterOptions,
} from "./shared";

export type StaticRouter = {
  currentPath: () => string;
  params: () => Record<string, string>;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  view: () => unknown;
  isActive: (path: string) => boolean;
};

export function createStaticRouter(
  routes: RouteDefinition[],
  options: RouterOptions = {},
  renderNotFound: (currentPath: string) => unknown,
): StaticRouter {
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

      return renderNotFound(currentPath);
    },
    isActive: (path: string) => Boolean(matchRoutePath(path, currentPath)),
  };
}
