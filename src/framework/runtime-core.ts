import {
  ATTR_BINDING,
  COMPONENT_REACTIVE_PROPS,
  DYNAMIC,
  LIST,
  NODE_FACTORY,
  TEMPLATE_FACTORY,
  TEXT_BINDING,
  type AttrBinding,
  type Dynamic,
  type DynamicKind,
  type ForProps,
  type KeyedList,
  type NodeFactory,
  type ShowProps,
  type TemplateFactory,
  type TextBinding,
  isAttrBinding,
  isDynamic,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
} from "./shared";

type EffectRunner = (() => void) & {
  deps: Set<Set<EffectRunner>>;
};

export type Scope = {
  parent: Scope | null;
  cleanups: Set<() => void>;
  active: boolean;
};

export interface Cell<T> {
  value: T;
  subscribers: Set<EffectRunner>;
}

type StoreState = {
  subscribers: Set<EffectRunner>;
  proxies: WeakMap<object, object>;
};

const queue = new Set<EffectRunner>();
let scheduled = false;
let activeEffect: EffectRunner | null = null;
let activeScope: Scope | null = null;

export const runtimeStats = {
  effectCreations: 0,
  effectRuns: 0,
  cleanupPasses: 0,
  scheduledEffects: 0,
  flushCycles: 0,
  cellReads: 0,
  cellWrites: 0,
  subscriptionsTracked: 0,
  domInsertions: 0,
  domRemovals: 0,
  domReplacements: 0,
  attrPatches: 0,
  textPatches: 0,
  inPlacePatches: 0,
};

export type RuntimeStats = typeof runtimeStats;

export function getRuntimeStats(): RuntimeStats {
  return { ...runtimeStats };
}

export function resetRuntimeStats(): void {
  runtimeStats.effectCreations = 0;
  runtimeStats.effectRuns = 0;
  runtimeStats.cleanupPasses = 0;
  runtimeStats.scheduledEffects = 0;
  runtimeStats.flushCycles = 0;
  runtimeStats.cellReads = 0;
  runtimeStats.cellWrites = 0;
  runtimeStats.subscriptionsTracked = 0;
  runtimeStats.domInsertions = 0;
  runtimeStats.domRemovals = 0;
  runtimeStats.domReplacements = 0;
  runtimeStats.attrPatches = 0;
  runtimeStats.textPatches = 0;
  runtimeStats.inPlacePatches = 0;
}

function flushQueue(): void {
  scheduled = false;
  runtimeStats.flushCycles += 1;

  while (queue.size > 0) {
    const jobs = Array.from(queue);
    queue.clear();

    for (const job of jobs) {
      job();
    }
  }
}

function schedule(runner: EffectRunner): void {
  if (!queue.has(runner)) {
    queue.add(runner);
    runtimeStats.scheduledEffects += 1;
  }

  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushQueue);
  }
}

function cleanup(runner: EffectRunner): void {
  runtimeStats.cleanupPasses += 1;

  for (const dependency of runner.deps) {
    dependency.delete(runner);
  }

  runner.deps.clear();
}

export function untrack<T>(fn: () => T): T {
  const previous = activeEffect;
  activeEffect = null;

  try {
    return fn();
  } finally {
    activeEffect = previous;
  }
}

export function createScope(): Scope {
  return {
    parent: activeScope,
    cleanups: new Set<() => void>(),
    active: true,
  };
}

export function onScopeCleanup(fn: () => void): void {
  if (!activeScope || !activeScope.active) {
    return;
  }

  activeScope.cleanups.add(fn);
}

export function runWithScope<T>(scope: Scope, fn: () => T): T {
  const previous = activeScope;
  activeScope = scope;

  try {
    return fn();
  } finally {
    activeScope = previous;
  }
}

export function disposeScope(scope: Scope | null): void {
  if (!scope || !scope.active) {
    return;
  }

  scope.active = false;

  const cleanups = Array.from(scope.cleanups);
  scope.cleanups.clear();

  for (const cleanup of cleanups.reverse()) {
    cleanup();
  }
}

export function cell<T>(value: T): Cell<T> {
  return {
    value,
    subscribers: new Set<EffectRunner>(),
  };
}

function trackSubscribers(subscribers: Set<EffectRunner>): void {
  if (!activeEffect) {
    return;
  }

  const tracked = !subscribers.has(activeEffect);
  subscribers.add(activeEffect);
  activeEffect.deps.add(subscribers);
  if (tracked) {
    runtimeStats.subscriptionsTracked += 1;
  }
}

function notifySubscribers(subscribers: Set<EffectRunner>): void {
  for (const subscriber of subscribers) {
    schedule(subscriber);
  }
}

function isStoreObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function createStoreProxy<T extends object>(target: T, state: StoreState): T {
  const existing = state.proxies.get(target);
  if (existing) {
    return existing as T;
  }

  const proxy = new Proxy(target, {
    get(currentTarget, key, receiver) {
      trackSubscribers(state.subscribers);
      const value = Reflect.get(currentTarget, key, receiver);
      return isStoreObject(value) ? createStoreProxy(value, state) : value;
    },

    set(currentTarget, key, value, receiver) {
      const previous = Reflect.get(currentTarget, key, receiver);
      const next = Reflect.set(currentTarget, key, value, receiver);

      if (next && !Object.is(previous, value)) {
        runtimeStats.cellWrites += 1;
        notifySubscribers(state.subscribers);
      }

      return next;
    },

    deleteProperty(currentTarget, key) {
      const existed = Reflect.has(currentTarget, key);
      const next = Reflect.deleteProperty(currentTarget, key);

      if (next && existed) {
        runtimeStats.cellWrites += 1;
        notifySubscribers(state.subscribers);
      }

      return next;
    },
  });

  state.proxies.set(target, proxy);
  return proxy;
}

export function store<T extends object>(value: T): T {
  const state: StoreState = {
    subscribers: new Set<EffectRunner>(),
    proxies: new WeakMap<object, object>(),
  };

  return createStoreProxy(value, state);
}

export function get<T>(slot: Cell<T>): T {
  runtimeStats.cellReads += 1;
  trackSubscribers(slot.subscribers);
  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
  runtimeStats.cellWrites += 1;

  if (Object.is(slot.value, next)) {
    return next;
  }

  slot.value = next;
  notifySubscribers(slot.subscribers);

  return next;
}

export function effect(fn: () => void): () => void {
  runtimeStats.effectCreations += 1;

  const runner = (() => {
    cleanup(runner);
    runtimeStats.effectRuns += 1;

    const previous = activeEffect;
    activeEffect = runner;

    try {
      fn();
    } finally {
      activeEffect = previous;
    }
  }) as EffectRunner;

  runner.deps = new Set<Set<EffectRunner>>();
  runner();
  const dispose = () => cleanup(runner);
  onScopeCleanup(dispose);
  return dispose;
}

export function node<T>(read: () => T): NodeFactory<T> {
  return {
    [NODE_FACTORY]: true,
    read,
  };
}

export function text<T>(cellValue: Cell<T>): TextBinding<T> {
  return {
    [TEXT_BINDING]: true,
    cell: cellValue,
  };
}

export function attr<T>(cellValue: Cell<T>): AttrBinding<T> {
  return {
    [ATTR_BINDING]: true,
    cell: cellValue,
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
    return get(value.cell as Cell<any>) as T;
  }

  if (isAttrBinding(value)) {
    return get(value.cell as Cell<any>) as T;
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

export function component<T extends (...args: any[]) => any>(fn: T): T {
  Object.defineProperty(fn, COMPONENT_REACTIVE_PROPS, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return fn;
}

export {
  isAttrBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
} from "./shared";
