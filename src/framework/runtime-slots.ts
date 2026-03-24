import {
  createScope,
  disposeScope,
  effect,
  get,
  isAttrBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
  runWithScope,
  type Cell,
  type Scope,
} from "./runtime-core";
import {
  BLOCK_END,
  BLOCK_START,
  bailHydration,
  claimHydrationNode,
  closeHydrationFrame,
  collectNodesBetween,
  currentHydrationFrame,
  isCommentNode,
  isHydrating,
  openHydrationFrame,
  warnHydrationMismatch,
} from "./runtime-hydration";
import {
  appendNode,
  cloneTemplate,
  insertNodeBefore,
  insertNodesBefore,
  removeNode,
  replaceNode,
} from "./runtime-dom";
import {
  bindEvent,
  canPatchNodeInPlace,
  canPatchNodeListInPlace,
  patchNodeInPlace,
} from "./runtime-patch";
import type { Dynamic, KeyedList } from "./shared";

type ListEntry<T> = {
  item: T;
  key: string | number;
  node: Node;
  scope: Scope;
};

const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

function resolveComponentPropValue(value: unknown): unknown {
  if (isDynamic(value)) {
    return value.read();
  }

  return value;
}

export function hasReactiveComponentProps(props: Record<string, unknown> | null): boolean {
  if (!props) {
    return false;
  }

  return Object.values(props).some((value) => isDynamic(value));
}

export function resolveComponentProps(
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

  if (isNodeFactory(value)) {
    return toNodeList(value.read());
  }

  if (isTextBinding(value)) {
    return [document.createTextNode(normalizeTextValue(get(value.cell as Cell<unknown>)))];
  }

  if (isTemplateFactory(value)) {
    if (isHydrating()) {
      return toNodeList(value.read());
    }

    return toNodeList(cloneTemplate(value.html));
  }

  if (isKeyedList(value)) {
    return toNodeList(value.read().map((item, index) => value.render(item, index)));
  }

  if (isDynamic(value)) {
    if (value.kind === "attr") {
      return [];
    }

    if (value.kind === "text") {
      return [document.createTextNode(normalizeTextValue(value.read()))];
    }

    return toNodeList(value.read());
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
    return nodes[0]!;
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
    return nodes[0]!;
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
          node: nodes[index]!,
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
      const item = items[index]!;
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

export function appendChild(parent: Node, value: unknown): void {
  if (isNodeFactory(value)) {
    appendChild(parent, value.read());
    return;
  }

  if (isTextBinding(value)) {
    mountTextBinding(parent, value.cell as Cell<unknown>);
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

function shouldDeferProperty(element: HTMLElement, key: string): boolean {
  return element instanceof HTMLSelectElement && key === "value";
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
    mountAttrBinding(element, key, value.cell as Cell<unknown>);
    return;
  }

  if (isDynamic(value)) {
    mountAttrSlot(element, key, value.read);
    return;
  }

  writeProperty(element, key, value);
}

export function applyProps(element: HTMLElement, props: Record<string, unknown>): Array<() => void> {
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
