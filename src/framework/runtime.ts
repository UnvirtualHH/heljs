type EffectRunner = (() => void) & {
  deps: Set<Set<EffectRunner>>;
};

type DynamicKind = "text" | "attr" | "block";

type HydrationFrame = {
  parent: Node;
  current: ChildNode | null;
  boundary: ChildNode | null;
  label: string;
};

type NodeFactory<T = unknown> = {
  [NODE_FACTORY]: true;
  read: () => T;
};

const BLOCK_START = "hs:block:start";
const BLOCK_END = "hs:block:end";
const NODE_FACTORY = Symbol("hel.node-factory");
const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

let activeEffect: EffectRunner | null = null;
const queue = new Set<EffectRunner>();
let scheduled = false;
const hydrationStack: HydrationFrame[] = [];
const hydratedRoots = new WeakSet<Element>();

function flushQueue(): void {
  scheduled = false;

  while (queue.size > 0) {
    const jobs = Array.from(queue);
    queue.clear();

    for (const job of jobs) {
      job();
    }
  }
}

function schedule(runner: EffectRunner): void {
  queue.add(runner);

  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushQueue);
  }
}

function cleanup(runner: EffectRunner): void {
  for (const dependency of runner.deps) {
    dependency.delete(runner);
  }

  runner.deps.clear();
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
    frame.parent.removeChild(node);
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
  if (activeEffect) {
    slot.subscribers.add(activeEffect);
    activeEffect.deps.add(slot.subscribers);
  }

  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
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
  const runner = (() => {
    cleanup(runner);

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

  return () => cleanup(runner);
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

function isDynamic(value: unknown): value is Dynamic {
  return typeof value === "object" && value !== null && DYNAMIC in value;
}

function isNodeFactory(value: unknown): value is NodeFactory {
  return typeof value === "object" && value !== null && NODE_FACTORY in value;
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
  parent.appendChild(document.createTextNode(value));
}

function mountTextSlot(parent: Node, read: () => unknown): void {
  const claimed = claimHydrationNode(parent, (node) => node.nodeType === Node.TEXT_NODE) as Text | null;
  if (!claimed && currentHydrationFrame(parent)?.current) {
    bailHydration(parent, "dynamic text");
  }
  const text = claimed ?? document.createTextNode("");

  if (!claimed) {
    parent.appendChild(text);
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

function mountBlockSlot(parent: Node, read: () => unknown): void {
  const frame = currentHydrationFrame(parent);
  let start = frame ? claimHydrationNode(parent, (node) => isCommentNode(node, BLOCK_START)) as Comment | null : null;
  let end: Comment | null = null;
  let currentNodes: Node[] = [];
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
    parent.appendChild(start);
    parent.appendChild(end);
  } else if (!end) {
    end = document.createComment(BLOCK_END);
    parent.appendChild(end);
  }

  effect(() => {
    const nextValue = read();

    if (hydrated) {
      const blockFrame = openHydrationFrame(parent, "block", end!);
      if (blockFrame) {
        blockFrame.current = start!.nextSibling as ChildNode | null;
      }
      appendChild(parent, nextValue);
      closeHydrationFrame(blockFrame);
      hydrated = false;
      currentNodes = collectNodesBetween(start!, end!);
      return;
    }

    const nextNodes = toNodeList(nextValue);

    for (const node of currentNodes) {
      if (node.parentNode === parent) {
        parent.removeChild(node);
      }
    }

    for (const node of nextNodes) {
      parent.insertBefore(node, end!);
    }

    currentNodes = nextNodes;
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
      parent.appendChild(value);
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

  if (normalizedKey === "class") {
    return element.className === normalizeTextValue(value);
  }

  if (value == null || value === false) {
    return !element.hasAttribute(normalizedKey);
  }

  if (value === true) {
    return element.hasAttribute(normalizedKey);
  }

  if (
    normalizedKey in element &&
    !normalizedKey.startsWith("data-") &&
    !normalizedKey.startsWith("aria-")
  ) {
    return Object.is((element as unknown as Record<string, unknown>)[normalizedKey], value);
  }

  return element.getAttribute(normalizedKey) === String(value);
}

function writeProperty(element: HTMLElement, key: string, value: unknown): void {
  const normalizedKey = key === "className" ? "class" : key;

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

  if (value == null || value === false) {
    element.removeAttribute(normalizedKey);
    return;
  }

  if (
    normalizedKey in element &&
    !normalizedKey.startsWith("data-") &&
    !normalizedKey.startsWith("aria-")
  ) {
    (element as unknown as Record<string, unknown>)[normalizedKey] = value;
    return;
  }

  if (value === true) {
    element.setAttribute(normalizedKey, "");
    return;
  }

  element.setAttribute(normalizedKey, String(value));
}

function applyProps(element: HTMLElement, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === "children") {
      continue;
    }

    if (key.startsWith("on") && typeof value === "function") {
      const eventName = key.slice(2).toLowerCase();
      element.addEventListener(eventName, value as EventListener);
      continue;
    }

    if (isDynamic(value)) {
      mountAttrSlot(element, key, value.read);
      continue;
    }

    writeProperty(element, key, value);
  }
}

export function h(
  tag: string | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Node {
  if (typeof tag === "function") {
    return toRenderableNode(tag({ ...(props ?? {}), children }));
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

  if (props) {
    applyProps(element, props);
  }

  for (const child of children) {
    appendChild(element, child);
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

export function mount(factory: () => Node, target: Element): void {
  hydrationStack.length = 0;
  hydratedRoots.add(target);
  target.replaceChildren(factory());
}

export function hydrate(factory: () => Node, target: Element): void {
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
    const result = factory();
    if (result.parentNode !== target) {
      target.replaceChildren(result);
    }
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
