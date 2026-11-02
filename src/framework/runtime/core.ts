import {
  ATTR_BINDING,
  BRANCH,
  CONTEXT_PROVIDER,
  type ContextDefinition,
  type BranchBinding,
  COMPONENT_REACTIVE_PROPS,
  DYNAMIC,
  LIST,
  NODE_FACTORY,
  REF_BINDING,
  TEMPLATE_FACTORY,
  TEXT_BINDING,
  type AttrBinding,
  type Dynamic,
  type DynamicKind,
  type ForProps,
  type KeyedList,
  type NodeFactory,
  type RefBinding,
  type ShowProps,
  type TemplateFactory,
  type TextBinding,
  isAttrBinding,
  isBranchBinding,
  isDynamic,
  isNodeFactory,
  isRefBinding,
  isTemplateFactory,
  isTextBinding,
  isThenable,
} from "../shared";

const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
const ERROR_HANDLER = Symbol("hel.error-handler");

type EffectRunner = (() => void) & {
  deps: Set<Set<EffectRunner>>;
  disposed: boolean;
  invalidate?: () => void;
};

const MAX_FLUSH_CYCLES = 100;
const EMPTY_CLEANUPS: Array<() => void> = [];
const EMPTY_MOUNTS: Array<() => void> = [];

type ContextFrame = {
  parent: ContextFrame | null;
  values: Map<symbol, unknown>;
};

export type Scope = {
  parent: Scope | null;
  frame: ContextFrame | null;
  cleanups: Array<() => void>;
  mounts: Array<() => void>;
  active: boolean;
  mounted: boolean;
};

export interface Cell<T> {
  value: T;
  subscribers: Set<EffectRunner>;
}

type StoreState = {
  propertySubscribers: WeakMap<object, Map<string | symbol, Set<EffectRunner>>>;
  proxies: WeakMap<object, object>;
};

const queue = new Set<EffectRunner>();
let scheduled = false;
let activeEffect: EffectRunner | null = null;
let activeScope: Scope | null = null;
let activeContextFrame: ContextFrame | null = null;

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

let flushBuffer: EffectRunner[] = [];
const mountQueue = new Set<Scope>();
let mountsScheduled = false;

function flushMountQueue(): void {
  mountsScheduled = false;

  for (const scope of mountQueue) {
    mountQueue.delete(scope);

    if (!scope.active) {
      continue;
    }

    const mounts = scope.mounts;
    scope.mounts = EMPTY_MOUNTS;

    if (mounts.length === 0) {
      continue;
    }

    // Mounts run in a microtask, outside the component that registered them.
    const previousFrame = activeContextFrame;
    activeContextFrame = scope.frame;

    for (let i = 0; i < mounts.length; i += 1) {
      try {
        runWithScope(scope, mounts[i]!);
      } catch (error) {
        handleError(error, scope.frame);
      }
    }

    activeContextFrame = previousFrame;
  }
}

function flushQueue(): void {
  scheduled = false;
  if (IS_DEV) runtimeStats.flushCycles += 1;

  let cycles = 0;

  while (queue.size > 0) {
    cycles += 1;

    if (cycles > MAX_FLUSH_CYCLES) {
      queue.clear();
      reportEffectError(
        new Error(`[hel] Effects kept triggering each other for ${MAX_FLUSH_CYCLES} cycles. A slot or effect probably writes state it also reads.`),
      );
      break;
    }

    for (const job of queue) {
      flushBuffer.push(job);
    }
    queue.clear();

    for (let i = 0; i < flushBuffer.length; i += 1) {
      try {
        flushBuffer[i]!();
      } catch (error) {
        reportEffectError(error);
      }
    }
    flushBuffer.length = 0;
  }
}

function reportEffectError(error: unknown): void {
  if (typeof reportError === "function") {
    reportError(error);
    return;
  }

  queueMicrotask(() => {
    throw error;
  });
}

// Scope parents are unknown during a flush, but effects restore their context
// frame on every run, so the nearest boundary is found through the frames.
function handleError(error: unknown, start: ContextFrame | null): void {
  let frame = start;

  while (frame) {
    if (frame.values.has(ERROR_HANDLER)) {
      (frame.values.get(ERROR_HANDLER) as (error: unknown) => void)(error);
      return;
    }
    frame = frame.parent;
  }

  reportEffectError(error);
}

function schedule(runner: EffectRunner): void {
  if (runner.invalidate) {
    runner.invalidate();
    return;
  }

  if (!queue.has(runner)) {
    queue.add(runner);
    if (IS_DEV) runtimeStats.scheduledEffects += 1;
  }

  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushQueue);
  }
}

function cleanup(runner: EffectRunner): void {
  if (IS_DEV) runtimeStats.cleanupPasses += 1;

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

function unwrapContextValue<T>(value: T): T {
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

function runWithFrameValue<R>(id: symbol, value: unknown, fn: () => R): R {
  const frame = {
    parent: activeContextFrame,
    values: new Map<symbol, unknown>([[id, value]]),
  };
  activeContextFrame = frame;

  try {
    return fn();
  } finally {
    activeContextFrame = frame.parent;
  }
}

export function runWithContext<T, R>(context: ContextDefinition<T>, value: T, fn: () => R): R {
  return runWithFrameValue(context.id, value, fn);
}

export function runWithErrorHandler<R>(handler: (error: unknown) => void, fn: () => R): R {
  return runWithFrameValue(ERROR_HANDLER, handler, fn);
}

export function createContext<T>(defaultValue: T): ContextDefinition<T> {
  const context = {
    id: Symbol("hel.context"),
    defaultValue,
  } as ContextDefinition<T>;

  const Provider = ((props: { value: T; children?: unknown[] }) => props.children ?? null) as ContextDefinition<T>["Provider"];
  Object.defineProperty(Provider, CONTEXT_PROVIDER, {
    value: context,
    enumerable: false,
    configurable: false,
  });

  context.Provider = Provider;
  return context;
}

export function useContext<T>(context: ContextDefinition<T>): T {
  let frame = activeContextFrame;

  while (frame) {
    if (frame.values.has(context.id)) {
      return unwrapContextValue(frame.values.get(context.id) as T);
    }
    frame = frame.parent;
  }

  if (IS_DEV && !activeScope && !activeEffect) {
    console.warn("[hel] useContext() ran outside a component, for example after an await, so it returned the default value. Read the context during setup.");
  }

  return context.defaultValue;
}

export function createScope(): Scope {
  return {
    parent: activeScope,
    frame: activeContextFrame,
    cleanups: EMPTY_CLEANUPS,
    mounts: EMPTY_MOUNTS,
    active: true,
    mounted: false,
  };
}

export function onScopeCleanup(fn: () => void): void {
  if (!activeScope || !activeScope.active) {
    return;
  }

  if (activeScope.cleanups === EMPTY_CLEANUPS) {
    activeScope.cleanups = [fn];
    return;
  }

  activeScope.cleanups.push(fn);
}

export function onCleanup(fn: () => void): void {
  if (IS_DEV && !activeScope?.active) {
    console.warn("[hel] onCleanup() ran outside a component, for example after an await, so it will never run. Register it during setup or before the first await.");
  }

  onScopeCleanup(fn);
}

export function onMount(fn: () => void): void {
  if (!activeScope || !activeScope.active || activeScope.mounted) {
    return;
  }

  if (activeScope.mounts === EMPTY_MOUNTS) {
    activeScope.mounts = [fn];
    return;
  }

  activeScope.mounts.push(fn);
}

export function getActiveScope(): Scope | null {
  return activeScope;
}

export function runWithScope<T>(scope: Scope | null, fn: () => T): T {
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

  const cleanups = scope.cleanups;
  scope.cleanups = EMPTY_CLEANUPS;

  if (cleanups.length === 0) {
    return;
  }

  // One failing cleanup must not keep the others from releasing what they hold.
  for (let i = cleanups.length - 1; i >= 0; i -= 1) {
    try {
      cleanups[i]!();
    } catch (error) {
      reportEffectError(error);
    }
  }
}

export function flushScopeMounts(scope: Scope | null): void {
  if (!scope || !scope.active || scope.mounted) {
    return;
  }

  scope.mounted = true;
  mountQueue.add(scope);

  if (!mountsScheduled) {
    mountsScheduled = true;
    queueMicrotask(flushMountQueue);
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
    if (IS_DEV) runtimeStats.subscriptionsTracked += 1;
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

const STORE_KEYS = Symbol("hel.store.keys");

function getPropertySubscribers(
  state: StoreState,
  target: object,
  key: string | symbol,
): Set<EffectRunner> {
  let targetSubscribers = state.propertySubscribers.get(target);
  if (!targetSubscribers) {
    targetSubscribers = new Map<string | symbol, Set<EffectRunner>>();
    state.propertySubscribers.set(target, targetSubscribers);
  }

  let subs = targetSubscribers.get(key);
  if (!subs) {
    subs = new Set<EffectRunner>();
    targetSubscribers.set(key, subs);
  }
  return subs;
}

function createStoreProxy<T extends object>(target: T, state: StoreState): T {
  const existing = state.proxies.get(target);
  if (existing) {
    return existing as T;
  }

  const proxy = new Proxy(target, {
    get(currentTarget, key, receiver) {
      trackSubscribers(getPropertySubscribers(state, currentTarget, key));
      const value = Reflect.get(currentTarget, key, receiver);
      return isStoreObject(value) ? createStoreProxy(value, state) : value;
    },

    has(currentTarget, key) {
      trackSubscribers(getPropertySubscribers(state, currentTarget, key));
      return Reflect.has(currentTarget, key);
    },

    ownKeys(currentTarget) {
      trackSubscribers(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      return Reflect.ownKeys(currentTarget);
    },

    set(currentTarget, key, value, receiver) {
      const previous = Reflect.get(currentTarget, key, receiver);
      const previousLength = Array.isArray(currentTarget) ? currentTarget.length : -1;
      const existed = Reflect.has(currentTarget, key);
      const next = Reflect.set(currentTarget, key, value, receiver);

      if (next && !Object.is(previous, value)) {
        if (IS_DEV) runtimeStats.cellWrites += 1;
        notifySubscribers(getPropertySubscribers(state, currentTarget, key));
      }

      if (next && !existed) {
        notifySubscribers(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      }

      if (
        next &&
        Array.isArray(currentTarget) &&
        key !== "length" &&
        currentTarget.length !== previousLength
      ) {
        notifySubscribers(getPropertySubscribers(state, currentTarget, "length"));
        notifySubscribers(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      }

      return next;
    },

    deleteProperty(currentTarget, key) {
      const existed = Reflect.has(currentTarget, key);
      const next = Reflect.deleteProperty(currentTarget, key);

      if (next && existed) {
        if (IS_DEV) runtimeStats.cellWrites += 1;
        notifySubscribers(getPropertySubscribers(state, currentTarget, key));
        notifySubscribers(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      }

      if (next && Array.isArray(currentTarget)) {
        notifySubscribers(getPropertySubscribers(state, currentTarget, "length"));
      }

      return next;
    },
  });

  state.proxies.set(target, proxy);
  return proxy;
}

export function store<T extends object>(value: T): T {
  const state: StoreState = {
    propertySubscribers: new WeakMap<object, Map<string | symbol, Set<EffectRunner>>>(),
    proxies: new WeakMap<object, object>(),
  };

  return createStoreProxy(value, state);
}

export function get<T>(slot: Cell<T>): T {
  if (IS_DEV) runtimeStats.cellReads += 1;
  trackSubscribers(slot.subscribers);
  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
  if (IS_DEV) runtimeStats.cellWrites += 1;

  if (Object.is(slot.value, next)) {
    return next;
  }

  slot.value = next;
  notifySubscribers(slot.subscribers);

  return next;
}

export function effect(fn: () => void): () => void {
  if (IS_DEV) runtimeStats.effectCreations += 1;

  // Re-runs happen in a flush, outside the provider that mounted this effect.
  const contextFrame = activeContextFrame;
  let started = false;

  const runner = (() => {
    if (runner.disposed) {
      return;
    }

    cleanup(runner);
    if (IS_DEV) runtimeStats.effectRuns += 1;

    const previous = activeEffect;
    const previousContextFrame = activeContextFrame;
    activeEffect = runner;
    activeContextFrame = contextFrame;

    try {
      fn();
    } catch (error) {
      // The first run happens while mounting, so whoever is mounting handles it.
      if (!started) {
        throw error;
      }

      handleError(error, contextFrame);
    } finally {
      activeEffect = previous;
      activeContextFrame = previousContextFrame;
    }
  }) as EffectRunner;

  runner.deps = new Set<Set<EffectRunner>>();
  runner.disposed = false;
  const dispose = () => {
    runner.disposed = true;
    queue.delete(runner);
    cleanup(runner);
  };

  try {
    runner();
  } catch (error) {
    dispose();
    throw error;
  }

  started = true;

  // Without dependencies it can never run again, so there is nothing to clean
  // up and the surrounding scope still counts as static.
  if (runner.deps.size > 0) {
    onScopeCleanup(dispose);
  }

  return dispose;
}

// Handlers read derived values right after writing state, so invalidation is
// synchronous and the recomputation happens on the next read.
export function memo<T>(fn: () => T, lazy = false): () => T {
  const subscribers = new Set<EffectRunner>();
  const contextFrame = activeContextFrame;
  let dirty = true;
  let value: T;
  let scope: Scope | null = null;

  const node = (() => undefined) as EffectRunner;
  node.deps = new Set<Set<EffectRunner>>();
  node.disposed = false;
  node.invalidate = () => {
    if (!dirty) {
      dirty = true;
      notifySubscribers(subscribers);
    }
  };

  const recompute = (): void => {
    cleanup(node);
    disposeScope(scope);
    const nextScope = createScope();
    scope = nextScope;

    const previous = activeEffect;
    const previousContextFrame = activeContextFrame;
    activeEffect = node;
    activeContextFrame = contextFrame;
    dirty = false;

    try {
      value = runWithScope(nextScope, fn);
    } catch (error) {
      dirty = true;
      throw error;
    } finally {
      activeEffect = previous;
      activeContextFrame = previousContextFrame;
    }

    if (IS_DEV && isThenable(value) && node.deps.size > 0) {
      console.warn("[hel] A const holds a Promise and starts it again on every change, with no protection against races. Use useResource() instead.");
    }
  };

  onScopeCleanup(() => {
    node.disposed = true;
    cleanup(node);
    disposeScope(scope);
  });

  if (!lazy) {
    recompute();
  }

  return () => {
    if (node.disposed) {
      return dirty ? untrack(fn) : value;
    }

    trackSubscribers(subscribers);

    if (dirty) {
      recompute();
    }

    return value;
  };
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

export function ref<T extends Element>(assign: (value: T) => void): RefBinding<T> {
  return {
    [REF_BINDING]: true,
    assign,
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

export function branch<T>(
  when: () => unknown,
  consequent: () => T,
  alternate: () => T,
): BranchBinding<T> {
  return {
    [BRANCH]: true,
    when,
    consequent,
    alternate,
  };
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
  const readItems = () => (unwrapControlFlowValue(props.each) ?? []) as T[];
  const render = unwrapControlFlowValue(props.children?.[0]);
  const renderItem = (typeof render === "function" ? render : (item: T) => item) as (item: T, index: number) => unknown;

  const rows = props.key
    ? list(readItems, props.key, renderItem)
    : dynBlock(() => readItems().map((item, index) => renderItem(item, index)));

  if (!("fallback" in props)) {
    return rows;
  }

  return branch(
    () => readItems().length === 0,
    () => unwrapControlFlowValue(props.fallback) ?? null,
    () => rows,
  );
}

export function Show(rawProps: Record<string, unknown>): any {
  const props = rawProps as ShowProps;
  return branch(
    () => unwrapControlFlowValue(props.when),
    () => props.children ?? null,
    () => unwrapControlFlowValue(props.fallback) ?? null,
  );
}

export function component<T extends (...args: any[]) => any>(fn: T): T {
  Object.defineProperty(fn, COMPONENT_REACTIVE_PROPS, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return fn;
}

component(For);
component(Show);

export {
  isAttrBinding,
  isBranchBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isRefBinding,
  isTemplateFactory,
  isTextBinding,
} from "../shared";
