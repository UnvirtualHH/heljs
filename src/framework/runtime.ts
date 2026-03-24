type EffectRunner = (() => void) & {
  deps: Set<Set<EffectRunner>>;
};

type DynamicKind = "text" | "attr" | "block";

type ListEntry<T> = {
  item: T;
  key: string | number;
  node: Node;
  scope: Scope;
};

type HydrationFrame = {
  parent: Node;
  current: ChildNode | null;
  boundary: ChildNode | null;
  label: string;
};

type Scope = {
  parent: Scope | null;
  cleanups: Set<() => void>;
  active: boolean;
};

type NodeFactory<T = unknown> = {
  [NODE_FACTORY]: true;
  read: () => T;
};

type TextBinding<T = unknown> = {
  [TEXT_BINDING]: true;
  cell: Cell<T>;
};

type AttrBinding<T = unknown> = {
  [ATTR_BINDING]: true;
  cell: Cell<T>;
};

type TemplateFactory<T = unknown> = {
  [TEMPLATE_FACTORY]: true;
  html: string;
  read: () => T;
};

type KeyedList<T> = {
  [LIST]: true;
  read: () => T[];
  key: (item: T, index: number) => string | number;
  render: (item: T, index: number) => unknown;
};

type ForProps<T> = {
  each: T[];
  key?: (item: T, index: number) => string | number;
  fallback?: unknown;
  children?: Array<((item: T, index: number) => unknown) | unknown>;
};

type ShowProps = {
  when: unknown;
  fallback?: unknown;
  children?: unknown[];
};

const BLOCK_START = "hs:block:start";
const BLOCK_END = "hs:block:end";
const NODE_FACTORY = Symbol("hel.node-factory");
const TEXT_BINDING = Symbol("hel.text-binding");
const ATTR_BINDING = Symbol("hel.attr-binding");
const TEMPLATE_FACTORY = Symbol("hel.template-factory");
const LIST = Symbol("hel.list");
const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
const NON_PATCHABLE_TAGS = new Set(["input", "textarea", "select", "option"]);

let activeEffect: EffectRunner | null = null;
const queue = new Set<EffectRunner>();
let scheduled = false;
const hydrationStack: HydrationFrame[] = [];
const hydratedRoots = new WeakSet<Element>();
const eventBindings = new WeakMap<HTMLElement, Map<string, EventListener>>();
const templateCache = new Map<string, HTMLTemplateElement>();
let activeScope: Scope | null = null;
const runtimeStats = {
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

function appendNode(parent: Node, node: Node): void {
  parent.appendChild(node);
  if (parent.isConnected) {
    runtimeStats.domInsertions += 1;
  }
}

function insertNodeBefore(parent: Node, node: Node, reference: Node | null): void {
  parent.insertBefore(node, reference);
  if (parent.isConnected) {
    runtimeStats.domInsertions += 1;
  }
}

function insertNodesBefore(parent: Node, nodes: Node[], reference: Node | null): void {
  if (nodes.length === 0) {
    return;
  }

  if (nodes.length === 1) {
    insertNodeBefore(parent, nodes[0]!, reference);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.appendChild(node);
  }

  parent.insertBefore(fragment, reference);
  if (parent.isConnected) {
    runtimeStats.domInsertions += nodes.length;
  }
}

function removeNode(parent: Node, node: Node): void {
  parent.removeChild(node);
  if (parent.isConnected) {
    runtimeStats.domRemovals += 1;
  }
}

function replaceNode(parent: Node, next: Node, current: Node): void {
  parent.replaceChild(next, current);
  if (parent.isConnected) {
    runtimeStats.domReplacements += 1;
  }
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

function createScope(): Scope {
  return {
    parent: activeScope,
    cleanups: new Set<() => void>(),
    active: true,
  };
}

function onScopeCleanup(fn: () => void): void {
  if (!activeScope || !activeScope.active) {
    return;
  }

  activeScope.cleanups.add(fn);
}

function runWithScope<T>(scope: Scope, fn: () => T): T {
  const previous = activeScope;
  activeScope = scope;

  try {
    return fn();
  } finally {
    activeScope = previous;
  }
}

function disposeScope(scope: Scope | null): void {
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

function isHydrating(): boolean {
  return hydrationStack.length > 0;
}

function currentHydrationFrame(parent?: Node): HydrationFrame | null {
  const frame = hydrationStack[hydrationStack.length - 1] ?? null;
  if (!frame) {
    return null;
  }

  if (parent && frame.parent !== parent) {
    return null;
  }

  return frame;
}

function describeNode(node: Node | null): string {
  if (!node) {
    return "nothing";
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return "text";
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return `comment(${(node as Comment).data})`;
  }

  if (node instanceof HTMLElement) {
    return `<${node.tagName.toLowerCase()}>`;
  }

  return node.nodeName.toLowerCase();
}

function hydrationPath(expected: string): string {
  const labels = hydrationStack.map((frame) => frame.label);
  labels.push(expected);
  return labels.join(" > ");
}

function warnHydrationMismatch(expected: string, actual: Node | null): void {
  if (!IS_DEV) {
    return;
  }

  console.warn(
    `[hel] Hydration mismatch at ${hydrationPath(expected)}. Expected ${expected}, found ${describeNode(actual)}.`,
  );
}

function skipIgnorableNodes(frame: HydrationFrame): void {
  while (
    frame.current &&
    frame.current !== frame.boundary &&
    frame.current.nodeType === Node.TEXT_NODE &&
    (frame.current as Text).data.trim() === ""
  ) {
    frame.current = frame.current.nextSibling as ChildNode | null;
  }
}

function claimHydrationNode(parent: Node, predicate: (node: ChildNode) => boolean): ChildNode | null {
  const frame = currentHydrationFrame(parent);
  if (!frame) {
    return null;
  }

  skipIgnorableNodes(frame);
  const node = frame.current;
  if (!node || node === frame.boundary || !predicate(node)) {
    return null;
  }

  frame.current = node.nextSibling as ChildNode | null;
  return node;
}

function bailHydration(parent: Node, expected: string, actual?: Node | null): void {
  const frame = currentHydrationFrame(parent);
  if (!frame) {
    return;
  }

  warnHydrationMismatch(expected, actual ?? frame.current);
  clearRemainingHydrationNodes(frame);
}

function openHydrationFrame(parent: Node, label: string, boundary: ChildNode | null = null): HydrationFrame | null {
  if (!isHydrating()) {
    return null;
  }

  const frame: HydrationFrame = {
    parent,
    current: parent.firstChild,
    boundary,
    label,
  };
  hydrationStack.push(frame);
  return frame;
}

function closeHydrationFrame(frame: HydrationFrame | null): void {
  if (!frame) {
    return;
  }

  skipIgnorableNodes(frame);
  clearRemainingHydrationNodes(frame);

  const current = hydrationStack[hydrationStack.length - 1];
  if (current === frame) {
    hydrationStack.pop();
  }
}

function clearRemainingHydrationNodes(frame: HydrationFrame): void {
  while (frame.current && frame.current !== frame.boundary) {
    const node = frame.current;
    frame.current = node.nextSibling as ChildNode | null;
    removeNode(frame.parent, node);
  }
}

function isCommentNode(node: Node | null, data: string): node is Comment {
  return Boolean(node && node.nodeType === Node.COMMENT_NODE && (node as Comment).data === data);
}

function collectNodesBetween(start: Comment, end: Comment): Node[] {
  const nodes: Node[] = [];
  let current = start.nextSibling;

  while (current && current !== end) {
    nodes.push(current);
    current = current.nextSibling;
  }

  return nodes;
}

export interface Cell<T> {
  value: T;
  subscribers: Set<EffectRunner>;
}

export function cell<T>(value: T): Cell<T> {
  return {
    value,
    subscribers: new Set<EffectRunner>(),
  };
}

export function get<T>(slot: Cell<T>): T {
  runtimeStats.cellReads += 1;

  if (activeEffect) {
    const tracked = !slot.subscribers.has(activeEffect);
    slot.subscribers.add(activeEffect);
    activeEffect.deps.add(slot.subscribers);
    if (tracked) {
      runtimeStats.subscriptionsTracked += 1;
    }
  }

  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
  runtimeStats.cellWrites += 1;

  if (Object.is(slot.value, next)) {
    return next;
  }

  slot.value = next;

  for (const subscriber of slot.subscribers) {
    schedule(subscriber);
  }

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

const DYNAMIC = Symbol("hel.dynamic");

export type Dynamic<T = unknown> = {
  [DYNAMIC]: true;
  kind: DynamicKind;
  read: () => T;
};

export function node<T>(read: () => T): NodeFactory<T> {
  return {
    [NODE_FACTORY]: true,
    read,
  };
}

export function text<T>(cell: Cell<T>): TextBinding<T> {
  return {
    [TEXT_BINDING]: true,
    cell,
  };
}

export function attr<T>(cell: Cell<T>): AttrBinding<T> {
  return {
    [ATTR_BINDING]: true,
    cell,
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
    return get(value.cell) as T;
  }

  if (isAttrBinding(value)) {
    return get(value.cell) as T;
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

function isDynamic(value: unknown): value is Dynamic {
  return typeof value === "object" && value !== null && DYNAMIC in value;
}

function isNodeFactory(value: unknown): value is NodeFactory {
  return typeof value === "object" && value !== null && NODE_FACTORY in value;
}

function isTextBinding(value: unknown): value is TextBinding {
  return typeof value === "object" && value !== null && TEXT_BINDING in value;
}

function isAttrBinding(value: unknown): value is AttrBinding {
  return typeof value === "object" && value !== null && ATTR_BINDING in value;
}

function isTemplateFactory(value: unknown): value is TemplateFactory {
  return typeof value === "object" && value !== null && TEMPLATE_FACTORY in value;
}

function isKeyedList(value: unknown): value is KeyedList<unknown> {
  return typeof value === "object" && value !== null && LIST in value;
}

function cloneTemplate(html: string): Node {
  let template = templateCache.get(html);
  if (!template) {
    template = document.createElement("template");
    template.innerHTML = html;
    templateCache.set(html, template);
  }

  const fragment = template.content.cloneNode(true) as DocumentFragment;
  if (fragment.childNodes.length === 1) {
    return fragment.firstChild!;
  }

  return fragment;
}

function canPatchNodeInPlace(current: Node, next: Node): boolean {
  if (current.nodeType !== next.nodeType) {
    return false;
  }

  if (current.nodeType === Node.TEXT_NODE) {
    return true;
  }

  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
    return false;
  }

  if (current.tagName !== next.tagName) {
    return false;
  }

  if (NON_PATCHABLE_TAGS.has(current.tagName.toLowerCase())) {
    return false;
  }

  if (eventBindings.has(current) || eventBindings.has(next)) {
    return false;
  }

  if (current.childNodes.length !== next.childNodes.length) {
    return false;
  }

  for (let index = 0; index < current.childNodes.length; index += 1) {
    if (!canPatchNodeInPlace(current.childNodes[index]!, next.childNodes[index]!)) {
      return false;
    }
  }

  return true;
}

function syncAttributes(current: HTMLElement, next: HTMLElement): void {
  const currentNames = new Set(Array.from(current.getAttributeNames()));
  const nextNames = new Set(Array.from(next.getAttributeNames()));

  for (const name of currentNames) {
    if (!nextNames.has(name)) {
      current.removeAttribute(name);
      runtimeStats.attrPatches += 1;
    }
  }

  for (const name of nextNames) {
    const nextValue = next.getAttribute(name);
    if (current.getAttribute(name) !== nextValue) {
      if (nextValue === null) {
        current.removeAttribute(name);
      } else {
        current.setAttribute(name, nextValue);
      }
      runtimeStats.attrPatches += 1;
    }
  }
}

function patchNodeInPlace(current: Node, next: Node): void {
  if (current.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
    const currentText = current as Text;
    const nextText = next as Text;
    if (currentText.data !== nextText.data) {
      currentText.data = nextText.data;
      runtimeStats.textPatches += 1;
    }
    return;
  }

  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
    return;
  }

  runtimeStats.inPlacePatches += 1;
  syncAttributes(current, next);

  for (let index = 0; index < current.childNodes.length; index += 1) {
    patchNodeInPlace(current.childNodes[index]!, next.childNodes[index]!);
  }
}

function canPatchNodeListInPlace(currentNodes: Node[], nextNodes: Node[]): boolean {
  if (currentNodes.length !== nextNodes.length) {
    return false;
  }

  for (let index = 0; index < currentNodes.length; index += 1) {
    if (!canPatchNodeInPlace(currentNodes[index]!, nextNodes[index]!)) {
      return false;
    }
  }

  return true;
}

function resolveComponentPropValue(value: unknown): unknown {
  if (isDynamic(value)) {
    return value.read();
  }

  return value;
}

function hasReactiveComponentProps(props: Record<string, unknown> | null): boolean {
  if (!props) {
    return false;
  }

  return Object.values(props).some((value) => isDynamic(value));
}

function resolveComponentProps(
  props: Record<string, unknown> | null,
  children: unknown[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {
    ...(props ?? {}),
    children,
  };

  for (const [key, value] of Object.entries(resolved)) {
    resolved[key] = resolveComponentPropValue(value);
  }

  return resolved;
}

function normalizeTextValue(value: unknown): string {
  if (value == null || value === false || value === true) {
    return "";
  }

  return String(value);
}

function toNodeList(value: unknown): Node[] {
  if (value == null || value === false || value === true) {
    return [];
  }

  if (Array.isArray(value)) {
    const nodes: Node[] = [];

    for (const item of value) {
      nodes.push(...toNodeList(item));
    }

    return nodes;
  }

  if (isKeyedList(value)) {
    return toNodeList(value.read().map((item, index) => value.render(item, index)));
  }

  if (value instanceof DocumentFragment) {
    return Array.from(value.childNodes);
  }

  if (value instanceof Node) {
    return [value];
  }

  return [document.createTextNode(String(value))];
}

function toRenderableNode(value: unknown): Node {
  const nodes = toNodeList(value);

  if (nodes.length === 0) {
    return document.createComment("empty");
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.appendChild(node);
  }

  return fragment;
}

function readSingleRenderableNode(value: unknown, context: string): Node {
  const nodes = toNodeList(value);

  if (nodes.length === 1) {
    return nodes[0];
  }

  if (IS_DEV) {
    console.warn(`[hel] ${context} expects each item to render exactly one root node.`);
  }

  return toRenderableNode(value);
}

function mountStaticText(parent: Node, value: string): void {
  const claimed = claimHydrationNode(parent, (node) => node.nodeType === Node.TEXT_NODE) as Text | null;
  if (claimed) {
    if (claimed.data !== value) {
      warnHydrationMismatch(`text("${value}")`, claimed);
    }
    if (claimed.data !== value) {
      claimed.data = value;
    }
    return;
  }

  if (currentHydrationFrame(parent)?.current) {
    bailHydration(parent, `text("${value}")`);
  }
  appendNode(parent, document.createTextNode(value));
}

function mountTextSlot(parent: Node, read: () => unknown): void {
  const claimed = claimHydrationNode(parent, (node) => node.nodeType === Node.TEXT_NODE) as Text | null;
  if (!claimed && currentHydrationFrame(parent)?.current) {
    bailHydration(parent, "dynamic text");
  }
  const text = claimed ?? document.createTextNode("");

  if (!claimed) {
    appendNode(parent, text);
  }

  let previous = claimed ? text.data : "";
  effect(() => {
    const next = normalizeTextValue(read());
    if (next === previous) {
      return;
    }

    previous = next;
    text.data = next;
  });
}

function mountTextBinding(parent: Node, cell: Cell<unknown>): void {
  const claimed = claimHydrationNode(parent, (node) => node.nodeType === Node.TEXT_NODE) as Text | null;
  if (!claimed && currentHydrationFrame(parent)?.current) {
    bailHydration(parent, "dynamic text");
  }
  const text = claimed ?? document.createTextNode("");

  if (!claimed) {
    appendNode(parent, text);
  }

  let previous = claimed ? text.data : "";
  effect(() => {
    const next = normalizeTextValue(get(cell));
    if (next === previous) {
      return;
    }

    previous = next;
    text.data = next;
  });
}

function mountAttrBinding(element: HTMLElement, key: string, cell: Cell<unknown>): void {
  let initialized = false;
  let previous: unknown;
  let hydrated = isHydrating();

  effect(() => {
    const next = get(cell);

    if (hydrated) {
      hydrated = false;
      if (!matchesHydratedProperty(element, key, next)) {
        warnHydrationMismatch(`attr(${key})`, element);
        writeProperty(element, key, next);
      }
      previous = next;
      initialized = true;
      return;
    }

    if (initialized && Object.is(previous, next)) {
      return;
    }

    previous = next;
    initialized = true;
    writeProperty(element, key, next);
  });
}

function mountBlockSlot(parent: Node, read: () => unknown): void {
  const frame = currentHydrationFrame(parent);
  let start = frame ? claimHydrationNode(parent, (node) => isCommentNode(node, BLOCK_START)) as Comment | null : null;
  let end: Comment | null = null;
  let currentNodes: Node[] = [];
  let contentScope: Scope | null = null;
  let hydrated = false;

  if (start && frame) {
    currentNodes = [];
    let cursor = start.nextSibling;

    while (cursor && !isCommentNode(cursor, BLOCK_END)) {
      currentNodes.push(cursor);
      cursor = cursor.nextSibling;
    }

    if (isCommentNode(cursor, BLOCK_END)) {
      end = cursor;
      frame.current = end.nextSibling as ChildNode | null;
      hydrated = true;
    } else {
      frame.current = start;
      bailHydration(parent, `comment(${BLOCK_START}) ... comment(${BLOCK_END})`, cursor);
      start = null;
      currentNodes = [];
    }
  }

  if (!start) {
    if (frame?.current) {
      bailHydration(parent, `comment(${BLOCK_START})`);
    }
    start = document.createComment(BLOCK_START);
    end = document.createComment(BLOCK_END);
    appendNode(parent, start);
    appendNode(parent, end);
  } else if (!end) {
    end = document.createComment(BLOCK_END);
    appendNode(parent, end);
  }

  effect(() => {
    if (hydrated) {
      disposeScope(contentScope);
      contentScope = createScope();
      const blockFrame = openHydrationFrame(parent, "block", end!);
      if (blockFrame) {
        blockFrame.current = start!.nextSibling as ChildNode | null;
      }
      const nextValue = runWithScope(contentScope, () => read());
      runWithScope(contentScope, () => appendChild(parent, nextValue));
      closeHydrationFrame(blockFrame);
      hydrated = false;
      currentNodes = collectNodesBetween(start!, end!);
      return;
    }

    disposeScope(contentScope);
    contentScope = createScope();
    const nextValue = runWithScope(contentScope, () => read());
    const nextNodes = runWithScope(contentScope, () => toNodeList(nextValue));

    if (canPatchNodeListInPlace(currentNodes, nextNodes)) {
      for (let index = 0; index < currentNodes.length; index += 1) {
        patchNodeInPlace(currentNodes[index]!, nextNodes[index]!);
      }
      disposeScope(contentScope);
      currentNodes = currentNodes.slice();
      return;
    }

    if (
      currentNodes.length === 1 &&
      nextNodes.length === 1 &&
      currentNodes[0]!.parentNode === parent
    ) {
      replaceNode(parent, nextNodes[0]!, currentNodes[0]!);
      currentNodes = nextNodes;
      return;
    }

    for (const node of currentNodes) {
      if (node.parentNode === parent) {
        removeNode(parent, node);
      }
    }

    insertNodesBefore(parent, nextNodes, end!);

    currentNodes = nextNodes;
  });
}

function mountListSlot<T>(parent: Node, binding: KeyedList<T>): void {
  const frame = currentHydrationFrame(parent);
  let start = frame ? claimHydrationNode(parent, (node) => isCommentNode(node, BLOCK_START)) as Comment | null : null;
  let end: Comment | null = null;
  let currentEntries: Array<ListEntry<T>> = [];
  let hydrated = false;

  if (start && frame) {
    let cursor = start.nextSibling;

    while (cursor && !isCommentNode(cursor, BLOCK_END)) {
      cursor = cursor.nextSibling;
    }

    if (isCommentNode(cursor, BLOCK_END)) {
      end = cursor;
      frame.current = end.nextSibling as ChildNode | null;
      hydrated = true;
    } else {
      frame.current = start;
      bailHydration(parent, `comment(${BLOCK_START}) ... comment(${BLOCK_END})`, cursor);
      start = null;
    }
  }

  if (!start) {
    if (frame?.current) {
      bailHydration(parent, `comment(${BLOCK_START})`);
    }
    start = document.createComment(BLOCK_START);
    end = document.createComment(BLOCK_END);
    appendNode(parent, start);
    appendNode(parent, end);
  } else if (!end) {
    end = document.createComment(BLOCK_END);
    appendNode(parent, end);
  }

  effect(() => {
    if (hydrated) {
      const items = binding.read();
      const nodes = collectNodesBetween(start!, end!);

      if (nodes.length !== items.length) {
        warnHydrationMismatch(`list(${items.length})`, start);
        for (const node of nodes) {
          if (node.parentNode === parent) {
            removeNode(parent, node);
          }
        }
        hydrated = false;
        currentEntries = [];
      } else {
        currentEntries = items.map((item, index) => ({
          item,
          key: binding.key(item, index),
          node: nodes[index],
          scope: createScope(),
        }));
        hydrated = false;
        return;
      }

      hydrated = false;
    }

    const items = binding.read();
    if (currentEntries.length === 0) {
      if (items.length === 0) {
        return;
      }

      const nextEntries: Array<ListEntry<T>> = [];
      const freshNodes: Node[] = [];

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        const scope = createScope();
        const node = runWithScope(scope, () => readSingleRenderableNode(binding.render(item, index), "list()"));
        freshNodes.push(node);
        nextEntries.push({
          item,
          key: binding.key(item, index),
          node,
          scope,
        });
      }

      insertNodesBefore(parent, freshNodes, end!);
      currentEntries = nextEntries;
      return;
    }

    if (currentEntries.length === items.length) {
      const nextEntries: Array<ListEntry<T>> = [];
      let stableOrder = true;

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        const key = binding.key(item, index);
        const previous = currentEntries[index]!;

        if (previous.key !== key) {
          stableOrder = false;
          break;
        }

        if (previous.item === item) {
          nextEntries.push(previous);
          continue;
        }

        const scope = createScope();
        const node = runWithScope(scope, () => readSingleRenderableNode(binding.render(item, index), "list()"));
        const canPatchInPlace =
          previous.node.parentNode === parent &&
          scope.cleanups.size === 0 &&
          canPatchNodeInPlace(previous.node, node);

        if (canPatchInPlace) {
          patchNodeInPlace(previous.node, node);
          disposeScope(scope);
          nextEntries.push({
            item,
            key,
            node: previous.node,
            scope: previous.scope,
          });
          continue;
        }

        if (previous.node.parentNode === parent) {
          replaceNode(parent, node, previous.node);
        }
        disposeScope(previous.scope);
        nextEntries.push({
          item,
          key,
          node,
          scope,
        });
      }

      if (stableOrder) {
        currentEntries = nextEntries;
        return;
      }
    }

    const previousByKey = new Map<string | number, ListEntry<T>>();

    for (const entry of currentEntries) {
      if (previousByKey.has(entry.key) && IS_DEV) {
        console.warn(`[hel] Duplicate key "${String(entry.key)}" in keyed list.`);
      }
      previousByKey.set(entry.key, entry);
    }

    const nextEntries: Array<ListEntry<T>> = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const key = binding.key(item, index);
      const previous = previousByKey.get(key);
      previousByKey.delete(key);

      if (previous && previous.item === item) {
        nextEntries.push(previous);
        continue;
      }

      const scope = createScope();
      const node = runWithScope(scope, () => readSingleRenderableNode(binding.render(item, index), "list()"));
      const canPatchInPlace =
        Boolean(previous?.node.parentNode === parent) &&
        scope.cleanups.size === 0 &&
        canPatchNodeInPlace(previous!.node, node);

      if (canPatchInPlace && previous) {
        patchNodeInPlace(previous.node, node);
        disposeScope(scope);
        nextEntries.push({
          item,
          key,
          node: previous.node,
          scope: previous.scope,
        });
        continue;
      }

      if (previous?.node.parentNode === parent) {
        replaceNode(parent, node, previous.node);
        disposeScope(previous.scope);
      }

      nextEntries.push({
        item,
        key,
        node,
        scope,
      });
    }

    for (const entry of previousByKey.values()) {
      if (entry.node.parentNode === parent) {
        removeNode(parent, entry.node);
      }
      disposeScope(entry.scope);
    }

    let anchor: Node = start!;
    let pendingInsertions: Node[] = [];
    let pendingReference: Node | null = end!;

    const flushPendingInsertions = (): void => {
      if (pendingInsertions.length === 0) {
        return;
      }

      insertNodesBefore(parent, pendingInsertions, pendingReference);
      pendingInsertions = [];
    };

    for (const entry of nextEntries) {
      const expectedNextSibling = anchor.nextSibling;
      if (expectedNextSibling === entry.node) {
        flushPendingInsertions();
        anchor = entry.node;
        continue;
      }

      if (entry.node.parentNode !== parent) {
        pendingInsertions.push(entry.node);
        pendingReference = expectedNextSibling ?? end!;
      } else {
        flushPendingInsertions();
        insertNodeBefore(parent, entry.node, expectedNextSibling ?? end!);
      }

      anchor = entry.node;
    }

    flushPendingInsertions();

    currentEntries = nextEntries;
  });
}

function mountAttrSlot(element: HTMLElement, key: string, read: () => unknown): void {
  let initialized = false;
  let previous: unknown;
  let hydrated = isHydrating();

  effect(() => {
    const next = read();

    if (hydrated) {
      hydrated = false;
      if (!matchesHydratedProperty(element, key, next)) {
        warnHydrationMismatch(`attr(${key})`, element);
        writeProperty(element, key, next);
      }
      previous = next;
      initialized = true;
      return;
    }

    if (initialized && Object.is(previous, next)) {
      return;
    }

    previous = next;
    initialized = true;
    writeProperty(element, key, next);
  });
}

function appendChild(parent: Node, value: unknown): void {
  if (isNodeFactory(value)) {
    appendChild(parent, value.read());
    return;
  }

  if (isTextBinding(value)) {
    mountTextBinding(parent, value.cell);
    return;
  }

  if (isTemplateFactory(value)) {
    if (isHydrating()) {
      appendChild(parent, value.read());
      return;
    }

    appendNode(parent, cloneTemplate(value.html));
    return;
  }

  if (isKeyedList(value)) {
    mountListSlot(parent, value);
    return;
  }

  if (isDynamic(value)) {
    if (value.kind === "text") {
      mountTextSlot(parent, value.read);
      return;
    }

    mountBlockSlot(parent, value.read);
    return;
  }

  if (value == null || value === false || value === true) {
    return;
  }

  if (value instanceof Node) {
    if (value.parentNode !== parent) {
      appendNode(parent, value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendChild(parent, item);
    }
    return;
  }

  mountStaticText(parent, String(value));
}

function matchesHydratedProperty(element: HTMLElement, key: string, value: unknown): boolean {
  const normalizedKey = key === "className" ? "class" : key;
  const isDomProperty =
    normalizedKey in element &&
    !normalizedKey.startsWith("data-") &&
    !normalizedKey.startsWith("aria-");

  if (normalizedKey === "class") {
    return element.className === normalizeTextValue(value);
  }

  if (isDomProperty) {
    const current = (element as unknown as Record<string, unknown>)[normalizedKey];

    if (typeof current === "boolean") {
      return current === Boolean(value);
    }

    if (value == null) {
      return current === "";
    }

    return Object.is(current, value);
  }

  if (value == null || value === false) {
    return !element.hasAttribute(normalizedKey);
  }

  if (value === true) {
    return element.hasAttribute(normalizedKey);
  }

  return element.getAttribute(normalizedKey) === String(value);
}

function writeProperty(element: HTMLElement, key: string, value: unknown): void {
  const normalizedKey = key === "className" ? "class" : key;
  const isDomProperty =
    normalizedKey in element &&
    !normalizedKey.startsWith("data-") &&
    !normalizedKey.startsWith("aria-");

  if (normalizedKey === "class") {
    if (value == null || value === false) {
      element.removeAttribute("class");
      return;
    }

    element.className = String(value);
    return;
  }

  if (normalizedKey === "style" && value && typeof value === "object") {
    Object.assign(element.style, value);
    return;
  }

  if (isDomProperty) {
    const target = element as unknown as Record<string, unknown>;
    const current = target[normalizedKey];

    if (typeof current === "boolean") {
      target[normalizedKey] = Boolean(value);

      if (value) {
        element.setAttribute(normalizedKey, "");
      } else {
        element.removeAttribute(normalizedKey);
      }
      return;
    }

    if (value == null) {
      target[normalizedKey] = "";
      element.removeAttribute(normalizedKey);
      return;
    }

    target[normalizedKey] = value;
    if (typeof value === "string" || typeof value === "number") {
      element.setAttribute(normalizedKey, String(value));
    }
    return;
  }

  if (value == null || value === false) {
    element.removeAttribute(normalizedKey);
    return;
  }

  if (value === true) {
    element.setAttribute(normalizedKey, "");
    return;
  }

  element.setAttribute(normalizedKey, String(value));
}

function shouldDeferProperty(element: HTMLElement, key: string): boolean {
  return element instanceof HTMLSelectElement && key === "value";
}

function bindEvent(element: HTMLElement, key: string, listener: EventListener): void {
  let bindings = eventBindings.get(element);
  if (!bindings) {
    bindings = new Map<string, EventListener>();
    eventBindings.set(element, bindings);
  }

  const eventName = key.slice(2).toLowerCase();
  const previous = bindings.get(key);

  if (previous === listener) {
    return;
  }

  if (previous) {
    element.removeEventListener(eventName, previous);
  }

  element.addEventListener(eventName, listener);
  bindings.set(key, listener);
}

function applyProp(element: HTMLElement, key: string, value: unknown): void {
  if (key === "children") {
    return;
  }

  if (key.startsWith("on") && typeof value === "function") {
    bindEvent(element, key, value as EventListener);
    return;
  }

  if (isAttrBinding(value)) {
    mountAttrBinding(element, key, value.cell);
    return;
  }

  if (isDynamic(value)) {
    mountAttrSlot(element, key, value.read);
    return;
  }

  writeProperty(element, key, value);
}

function applyProps(element: HTMLElement, props: Record<string, unknown>): Array<() => void> {
  const deferred: Array<() => void> = [];

  for (const [key, value] of Object.entries(props)) {
    if (shouldDeferProperty(element, key)) {
      deferred.push(() => applyProp(element, key, value));
      continue;
    }

    applyProp(element, key, value);
  }

  return deferred;
}

export function h(
  tag: string | ((props: any) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): unknown {
  if (typeof tag === "function") {
    const renderComponent = () => toRenderableNode(tag(resolveComponentProps(props, children)));

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

  for (const child of children) {
    appendChild(element, child);
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
  hydrationStack.length = 0;
  hydratedRoots.add(target);
  target.replaceChildren();
  appendChild(target, factory());
}

export function hydrate(factory: () => unknown, target: Element): void {
  if (hydratedRoots.has(target)) {
    mount(factory, target);
    return;
  }

  hydrationStack.length = 0;
  hydrationStack.push({
    parent: target,
    current: target.firstChild,
    boundary: null,
    label: "#app",
  });

  try {
    appendChild(target, factory());
    const rootFrame = hydrationStack[0];
    if (rootFrame) {
      skipIgnorableNodes(rootFrame);
      clearRemainingHydrationNodes(rootFrame);
    }
    hydratedRoots.add(target);
  } finally {
    hydrationStack.length = 0;
  }
}
