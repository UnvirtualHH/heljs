import {
  attr,
  branch,
  cell,
  component,
  createContext,
  createScope,
  disposeScope,
  dyn,
  dynAttr,
  dynBlock,
  dynText,
  effect,
  For,
  get,
  getRuntimeStats,
  isAttrBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
  list,
  node,
  onCleanup,
  onMount,
  onScopeCleanup,
  ref,
  resetRuntimeStats,
  runWithScope,
  runtimeStats,
  set,
  Show,
  store,
  text,
  tpl,
  type Cell,
  type RuntimeStats,
  type Scope,
  useContext,
  untrack,
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
  getRuntimeStats,
  list,
  node,
  onCleanup,
  onMount,
  ref,
  resetRuntimeStats,
  set,
  Show,
  store,
  text,
  tpl,
  useContext,
} from "./core";
export type { Cell, RuntimeStats } from "./core";
import {
  ATTR_BINDING,
  CONTEXT_PROVIDER,
  COMPONENT_REACTIVE_PROPS,
  LIST,
  NODE_FACTORY,
  TEMPLATE_FACTORY,
  TEXT_BINDING,
  type AttrBinding,
  type Dynamic,
  type KeyedList,
  type NodeFactory,
  type TemplateFactory,
  type TextBinding,
} from "../shared";
export type { ContextDefinition } from "../shared";
import {
  BLOCK_END,
  BLOCK_START,
  bailHydration,
  beginRootHydration,
  claimHydrationNode,
  clearRemainingHydrationNodes,
  closeHydrationFrame,
  collectNodesBetween,
  currentHydrationFrame,
  finalizeRootHydration,
  hasHydratedRoot,
  isCommentNode,
  isHydrating,
  markHydratedRoot,
  openHydrationFrame,
  resetHydrationState,
  skipIgnorableNodes,
  warnHydrationMismatch,
} from "./hydration";
import { createBrowserRouter, type BrowserRouter } from "./router";
import {
  appendNode,
} from "./dom";
import { componentResult } from "./component";
import {
  appendChild,
  applyProps,
  hasReactiveComponentProps,
  resolveComponentProps,
} from "./slots";

export type Router = BrowserRouter;

function isDirectTextChild(value: unknown): value is string | number | bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint";
}

const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

export function createRouter(routes: import("../shared").RouteDefinition[], options: import("../shared").RouterOptions = {}): Router {
  return createBrowserRouter(
    routes,
    options,
    (current) =>
      h(
        "section",
        { class: "route-miss" },
        h("h2", null, "Not found"),
        h("p", null, `No route matched ${current}.`),
      ),
  );
}

export function Link(
  props: Record<string, unknown> | null,
  ...children: unknown[]
): unknown {
  return h("a", props, ...children);
}

function createComponentPropsView(
  props: Record<string, unknown> | null,
  children: unknown[],
): Record<string, unknown> {
  const source: Record<string, unknown> = {
    ...(props ?? {}),
    children,
  };

  const view: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    Object.defineProperty(view, key, {
      enumerable: true,
      configurable: false,
      get() {
        if (isDynamic(value)) {
          return value.read();
        }

        if (isTextBinding(value)) {
          return get(value.cell as Cell<unknown>);
        }

        if (isAttrBinding(value)) {
          return get(value.cell as Cell<unknown>);
        }

        if (isNodeFactory(value)) {
          return value.read();
        }

        if (isTemplateFactory(value)) {
          return value.read();
        }

        return value;
      },
    });
  }

  return view;
}

function isContextProvider(tag: unknown): tag is ((props: any) => unknown) & { [CONTEXT_PROVIDER]: import("../shared").ContextDefinition<unknown> } {
  return Boolean(tag && typeof tag === "function" && (tag as unknown as Record<PropertyKey, unknown>)[CONTEXT_PROVIDER]);
}

function renderContextChildren(children: unknown[]): unknown {
  if (children.length === 0) {
    return null;
  }

  return frag(...children);
}

function supportsReactiveComponentProps(tag: unknown): boolean {
  return Boolean(
    tag &&
      typeof tag === "function" &&
      (tag as unknown as Record<PropertyKey, unknown>)[COMPONENT_REACTIVE_PROPS] === true,
  );
}

function renderComponentWithScope(render: () => unknown): unknown {
  const scope = createScope();
  onScopeCleanup(() => disposeScope(scope));
  const value = runWithScope(scope, render);
  return componentResult(value, scope);
}

export function h(
  tag: string | ((props: any) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): unknown {
  if (typeof tag === "function") {
    if (isContextProvider(tag)) {
      const context = tag[CONTEXT_PROVIDER];
      const renderProvider = () => {
        const resolvedProps = resolveComponentProps(props, children);
        const providerValue = resolvedProps.value;
        return runWithContext(context, providerValue, () => renderContextChildren(children));
      };

      if (hasReactiveComponentProps(props)) {
        return dynBlock(renderProvider);
      }

      return renderProvider();
    }

    if (hasReactiveComponentProps(props) && supportsReactiveComponentProps(tag)) {
      return renderComponentWithScope(() => tag(createComponentPropsView(props, children)));
    }

    const renderComponent = () => renderComponentWithScope(() => tag(resolveComponentProps(props, children)));

    if (hasReactiveComponentProps(props)) {
      return dynBlock(renderComponent);
    }

    return renderComponent();
  }

  const parent = currentHydrationFrame()?.parent ?? document;
  const claimed = claimHydrationNode(
    parent,
    (node) => node instanceof HTMLElement && node.tagName.toLowerCase() === tag,
  ) as HTMLElement | null;
  if (!claimed && currentHydrationFrame(parent)?.current) {
    bailHydration(parent, `<${tag}>`);
  }
  const element = claimed ?? document.createElement(tag);
  const frame = openHydrationFrame(element, `<${tag}>`);
  const deferredProps = props ? applyProps(element, props) : [];

  if (!claimed && children.length === 1 && isDirectTextChild(children[0])) {
    element.textContent = String(children[0]);
  } else {
    for (const child of children) {
      appendChild(element, child);
    }
  }

  for (const run of deferredProps) {
    run();
  }

  closeHydrationFrame(frame);
  return element;
}

export function frag(...children: unknown[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  for (const child of children) {
    appendChild(fragment, child);
  }

  return fragment;
}

export function mount(factory: () => unknown, target: Element): void {
  resetHydrationState();
  markHydratedRoot(target);
  target.replaceChildren();
  appendChild(target, factory());
}

export function hydrate(factory: () => unknown, target: Element): void {
  if (hasHydratedRoot(target)) {
    mount(factory, target);
    return;
  }

  beginRootHydration(target);

  try {
    appendChild(target, factory());
    finalizeRootHydration();
    markHydratedRoot(target);
  } finally {
    resetHydrationState();
  }
}
