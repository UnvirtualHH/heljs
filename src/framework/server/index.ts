import { createStaticRouter, type StaticRouter } from "./router";
import {
  attr,
  branch,
  cell,
  component,
  createContext,
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
  useContext,
  runWithContext,
} from "./core";
export {
  attr,
  branch,
  cell,
  component,
  createContext,
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
  useContext,
} from "./core";
export type { Cell } from "./core";
import { frag, h, renderToString, type Renderable } from "./render";
export { frag, h, renderToString } from "./render";
import type { RouteDefinition, RouterOptions } from "../shared";
export type { ContextDefinition } from "../shared";

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
