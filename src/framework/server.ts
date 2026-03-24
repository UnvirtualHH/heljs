import { createStaticRouter, type StaticRouter } from "./server-router";
import {
  attr,
  cell,
  component,
  dyn,
  dynAttr,
  dynBlock,
  dynText,
  effect,
  For,
  get,
  list,
  node,
  set,
  Show,
  store,
  text,
  tpl,
  type Cell,
} from "./server-core";
export {
  attr,
  cell,
  component,
  dyn,
  dynAttr,
  dynBlock,
  dynText,
  effect,
  For,
  get,
  list,
  node,
  set,
  Show,
  store,
  text,
  tpl,
} from "./server-core";
export type { Cell } from "./server-core";
import { frag, h, renderToString, type Renderable } from "./server-render";
export { frag, h, renderToString } from "./server-render";
import type { RouteDefinition, RouterOptions } from "./shared";

export type Router = StaticRouter;

export function createRouter(routes: RouteDefinition[], options: RouterOptions = {}): Router {
  return createStaticRouter(
    routes,
    options,
    (currentPath) =>
      h(
        "section",
        { class: "route-miss" },
        h("h2", null, "Not found"),
        h("p", null, `No route matched ${currentPath}.`),
      ),
  );
}

export function Link(
  props: Record<string, unknown> | null,
  ...children: any[]
): Renderable {
  return h("a", props, ...children);
}
