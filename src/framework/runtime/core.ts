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
  renderRowOnce,
} from "../shared";

const IS_DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
const ERROR_HANDLER = Symbol("hel.error-handler");

export type EffectNode = {
  fn: () => void;
  // Almost always one, so an array only appears for the second.
  deps: Source | Source[] | null;
  disposed: boolean;
  started: boolean;
  frame: ContextFrame | null;
  invalidate: (() => void) | null;
};

// Almost every source has one subscriber, so a Set only appears for the second.
type Source = {
  subscribers: EffectNode | Set<EffectNode> | null;
};

const MAX_FLUSH_CYCLES = 100;
const EMPTY_CLEANUPS: Array<(() => void) | EffectNode> = [];
const EMPTY_MOUNTS: Array<() => void> = [];

type ContextFrame = {
  parent: ContextFrame | null;
  values: Map<symbol, unknown>;
};

export type Scope = {
  frame: ContextFrame | null;
  cleanups: Array<(() => void) | EffectNode>;
  mounts: Array<() => void>;
  active: boolean;
  mounted: boolean;
};

export interface Cell<T> extends Source {
  value: T;
}

type StoreState = {
  propertySubscribers: WeakMap<object, Map<string | symbol, Source>>;
  proxies: WeakMap<object, object>;
};

const queue = new Set<EffectNode>();
let scheduled = false;
let activeEffect: EffectNode | null = null;
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

let flushBuffer: EffectNode[] = [];
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
        runEffect(flushBuffer[i]!);
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

function schedule(runner: EffectNode): void {
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

function cleanup(runner: EffectNode): void {
  if (IS_DEV) runtimeStats.cleanupPasses += 1;

  const { deps } = runner;

  if (deps === null) {
    return;
  }

  if (Array.isArray(deps)) {
    for (let i = 0; i < deps.length; i += 1) {
      unsubscribe(deps[i]!, runner);
    }
  } else {
    unsubscribe(deps, runner);
  }

  runner.deps = null;
}

function unsubscribe(source: Source, runner: EffectNode): void {
  if (source.subscribers === runner) {
    source.subscribers = null;
  } else {
    (source.subscribers as Set<EffectNode> | null)?.delete(runner);
  }
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
    const cleanup = cleanups[i]!;

    if (typeof cleanup !== "function") {
      disposeEffect(cleanup);
      continue;
    }

    try {
      cleanup();
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

  if (scope.mounts === EMPTY_MOUNTS) {
    return;
  }

  mountQueue.add(scope);

  if (!mountsScheduled) {
    mountsScheduled = true;
    queueMicrotask(flushMountQueue);
  }
}

export function cell<T>(value: T): Cell<T> {
  return {
    value,
    subscribers: null,
  };
}

function track(source: Source): void {
  const effect = activeEffect;
  if (!effect) {
    return;
  }

  const current = source.subscribers;

  if (current === effect) {
    return;
  }

  if (current === null) {
    source.subscribers = effect;
  } else if (current instanceof Set) {
    if (current.has(effect)) {
      return;
    }
    current.add(effect);
  } else {
    source.subscribers = new Set([current, effect]);
  }

  const { deps } = effect;

  if (deps === null) {
    effect.deps = source;
  } else if (Array.isArray(deps)) {
    deps.push(source);
  } else {
    effect.deps = [deps, source];
  }

  if (IS_DEV) runtimeStats.subscriptionsTracked += 1;
}

function notify(source: Source): void {
  const { subscribers } = source;

  if (subscribers === null) {
    return;
  }

  if (subscribers instanceof Set) {
    for (const subscriber of subscribers) {
      schedule(subscriber);
    }
  } else {
    schedule(subscribers);
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
): Source {
  let targetSubscribers = state.propertySubscribers.get(target);
  if (!targetSubscribers) {
    targetSubscribers = new Map<string | symbol, Source>();
    state.propertySubscribers.set(target, targetSubscribers);
  }

  let source = targetSubscribers.get(key);
  if (!source) {
    source = { subscribers: null };
    targetSubscribers.set(key, source);
  }
  return source;
}

function createStoreProxy<T extends object>(target: T, state: StoreState): T {
  const existing = state.proxies.get(target);
  if (existing) {
    return existing as T;
  }

  const proxy = new Proxy(target, {
    get(currentTarget, key, receiver) {
      track(getPropertySubscribers(state, currentTarget, key));
      const value = Reflect.get(currentTarget, key, receiver);
      return isStoreObject(value) ? createStoreProxy(value, state) : value;
    },

    has(currentTarget, key) {
      track(getPropertySubscribers(state, currentTarget, key));
      return Reflect.has(currentTarget, key);
    },

    ownKeys(currentTarget) {
      track(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      return Reflect.ownKeys(currentTarget);
    },

    set(currentTarget, key, value, receiver) {
      const previous = Reflect.get(currentTarget, key, receiver);
      const previousLength = Array.isArray(currentTarget) ? currentTarget.length : -1;
      const existed = Reflect.has(currentTarget, key);
      const next = Reflect.set(currentTarget, key, value, receiver);

      if (next && !Object.is(previous, value)) {
        if (IS_DEV) runtimeStats.cellWrites += 1;
        notify(getPropertySubscribers(state, currentTarget, key));
      }

      if (next && !existed) {
        notify(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      }

      if (
        next &&
        Array.isArray(currentTarget) &&
        key !== "length" &&
        currentTarget.length !== previousLength
      ) {
        notify(getPropertySubscribers(state, currentTarget, "length"));
        notify(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      }

      return next;
    },

    deleteProperty(currentTarget, key) {
      const existed = Reflect.has(currentTarget, key);
      const next = Reflect.deleteProperty(currentTarget, key);

      if (next && existed) {
        if (IS_DEV) runtimeStats.cellWrites += 1;
        notify(getPropertySubscribers(state, currentTarget, key));
        notify(getPropertySubscribers(state, currentTarget, STORE_KEYS));
      }

      if (next && Array.isArray(currentTarget)) {
        notify(getPropertySubscribers(state, currentTarget, "length"));
      }

      return next;
    },
  });

  state.proxies.set(target, proxy);
  return proxy;
}

export function store<T extends object>(value: T): T {
  const state: StoreState = {
    propertySubscribers: new WeakMap<object, Map<string | symbol, Source>>(),
    proxies: new WeakMap<object, object>(),
  };

  return createStoreProxy(value, state);
}

export function get<T>(slot: Cell<T>): T {
  if (IS_DEV) runtimeStats.cellReads += 1;
  track(slot);
  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
  if (IS_DEV) runtimeStats.cellWrites += 1;

  if (Object.is(slot.value, next)) {
    return next;
  }

  slot.value = next;
  notify(slot);

  return next;
}

function runEffect(runner: EffectNode): void {
  if (runner.disposed) {
    return;
  }

  cleanup(runner);
  if (IS_DEV) runtimeStats.effectRuns += 1;

  const previous = activeEffect;
  const previousContextFrame = activeContextFrame;
  activeEffect = runner;
  activeContextFrame = runner.frame;

  try {
    runner.fn();
  } catch (error) {
    // The first run happens while mounting, so whoever is mounting handles it.
    if (!runner.started) {
      throw error;
    }

    handleError(error, runner.frame);
  } finally {
    activeEffect = previous;
    activeContextFrame = previousContextFrame;
  }
}

export function disposeEffect(runner: EffectNode): void {
  runner.disposed = true;
  queue.delete(runner);
  cleanup(runner);
}

// Re-runs happen in a flush, outside the provider that mounted this effect, which
// is why it keeps its context frame. With `owned` off, the caller disposes it.
export function createEffect(fn: () => void, owned = true): EffectNode {
  if (IS_DEV) runtimeStats.effectCreations += 1;

  const runner: EffectNode = {
    fn,
    deps: null,
    disposed: false,
    started: false,
    frame: activeContextFrame,
    invalidate: null,
  };

  try {
    runEffect(runner);
  } catch (error) {
    disposeEffect(runner);
    throw error;
  }

  runner.started = true;

  // Without dependencies it can never run again, so there is nothing to clean
  // up and the surrounding scope still counts as static.
  if (owned && runner.deps !== null && activeScope?.active) {
    if (activeScope.cleanups === EMPTY_CLEANUPS) {
      activeScope.cleanups = [runner];
    } else {
      activeScope.cleanups.push(runner);
    }
  }

  return runner;
}

export function effect(fn: () => void): () => void {
  const runner = createEffect(fn);
  return () => disposeEffect(runner);
}

const PROBE_SCOPE = createScope();

// Runs code that might turn out to create something, and releases whatever it did.
export function runProbed<T>(read: () => T): T {
  const previous = activeScope;
  activeScope = PROBE_SCOPE;

  try {
    return read();
  } finally {
    activeScope = previous;

    if (PROBE_SCOPE.cleanups !== EMPTY_CLEANUPS) {
      disposeScope(PROBE_SCOPE);
      PROBE_SCOPE.active = true;
    }

    PROBE_SCOPE.mounts = EMPTY_MOUNTS;
  }
}

// Handlers read derived values right after writing state, so invalidation is
// synchronous and the recomputation happens on the next read.
export function memo<T>(fn: () => T, lazy = false): () => T {
  const source: Source = { subscribers: null };
  const contextFrame = activeContextFrame;
  let dirty = true;
  let value: T;
  let scope: Scope | null = null;

  const node: EffectNode = {
    fn: () => undefined,
    deps: null,
    disposed: false,
    started: true,
    frame: contextFrame,
    invalidate: () => {
      if (!dirty) {
        dirty = true;
        notify(source);
      }
    },
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

    if (IS_DEV && isThenable(value) && node.deps !== null) {
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

    track(source);

    if (dirty) {
      recompute();
    }

    return value;
  };
}

export function node<T>(read: () => T): NodeFactory<T> {
  return {
    $t: NODE_FACTORY,
    read,
  };
}

export function text<T>(cellValue: Cell<T>): TextBinding<T> {
  return {
    $t: TEXT_BINDING,
    cell: cellValue,
  };
}

export function attr<T>(cellValue: Cell<T>): AttrBinding<T> {
  return {
    $t: ATTR_BINDING,
    cell: cellValue,
  };
}

export function tpl<T>(html: string, read: () => T): TemplateFactory<T> {
  return {
    $t: TEMPLATE_FACTORY,
    html,
    read,
  };
}

export function ref<T extends Element>(assign: (value: T) => void): RefBinding<T> {
  return {
    $t: REF_BINDING,
    assign,
  };
}

function createDynamic<T>(kind: DynamicKind, read: () => T): Dynamic<T> {
  return {
    $t: DYNAMIC,
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
    $t: BRANCH,
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
    $t: LIST,
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
    : dynBlock(() => readItems().map((item, index) => renderRowOnce(renderItem, item, index)));

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
