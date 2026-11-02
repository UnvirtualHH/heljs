import {
  cell,
  createScope,
  disposeScope,
  effect,
  flushScopeMounts,
  get,
  getActiveScope,
  isAttrBinding,
  isBranchBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isRefBinding,
  onScopeCleanup,
  isTemplateFactory,
  isTextBinding,
  runWithScope,
  set,
  untrack,
  type Cell,
  type Scope,
} from "./core";
import { isComponentResult } from "./component";
import {
  BLOCK_END,
  BLOCK_START,
  bailHydration,
  claimHydrationNode,
  closeHydrationFrame,
  collectNodesBetween,
  currentHydrationFrame,
  findBlockEnd,
  isCommentNode,
  isHydrating,
  openHydrationFrame,
  warnHydrationMismatch,
} from "./hydration";
import {
  appendNode,
  cloneTemplate,
  insertNodeBefore,
  insertNodesBefore,
  moveNodesBetween,
  removeNode,
  replaceNode,
  replaceNodesBetween,
} from "./dom";
import {
  bindEvent,
  tryPatchNodeInPlace,
  tryPatchNodeListInPlace,
} from "./patch";
import type { Dynamic, KeyedList } from "../shared";

type ListEntry<T> = {
  item: Cell<T>;
  index: number;
  key: string | number;
  node: Node;
  scope: Scope;
};

const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

type RetainedBlockBranch = {
  signature: string;
  holder: DocumentFragment;
  scope: Scope;
};

// A scope with cleanups owns live effects or child components, so its nodes
// cannot be swapped for structurally equal ones without losing those bindings.
function isStaticScope(scope: Scope | null): boolean {
  return !scope || scope.cleanups.length === 0;
}

// Each row tracks what it read while rendering, so a change only re-renders that row.
function createListEntry<T>(
  binding: KeyedList<T>,
  item: T,
  index: number,
  key: string | number,
): ListEntry<T> {
  const entry: ListEntry<T> = {
    item: cell(item),
    index,
    key,
    node: null as unknown as Node,
    scope: createScope(),
  };
  let contentScope: Scope | null = null;

  runWithScope(entry.scope, () => {
    onScopeCleanup(() => disposeScope(contentScope));

    effect(() => {
      const current = get(entry.item);
      const wasStatic = isStaticScope(contentScope);
      disposeScope(contentScope);

      const nextScope = createScope();
      contentScope = nextScope;
      const node = runWithScope(nextScope, () =>
        readSingleRenderableNode(binding.render(current, entry.index), "list()"),
      );
      flushScopeMounts(nextScope);

      const previous = entry.node;
      if (!previous) {
        entry.node = node;
        return;
      }

      if (wasStatic && isStaticScope(nextScope) && tryPatchNodeInPlace(previous, node)) {
        return;
      }

      if (previous.parentNode) {
        replaceNode(previous.parentNode, node, previous);
      }
      entry.node = node;
    });
  });

  return entry;
}

function resolveComponentPropValue(value: unknown): unknown {
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
}

function getNodeSignature(node: Node): string {
  if (node instanceof HTMLElement) {
    return `element:${node.tagName}[${Array.from(node.childNodes, getNodeSignature).join("|")}]`;
  }

  if (node instanceof Text) {
    return "text";
  }

  if (node instanceof Comment) {
    return "comment";
  }

  return node.nodeName;
}

function getNodeListSignature(nodes: Node[]): string {
  return nodes.map(getNodeSignature).join("|");
}

function containsRetainableMarker(node: Node): boolean {
  if (isCommentNode(node, BLOCK_START) || isCommentNode(node, BLOCK_END)) {
    return true;
  }

  for (const child of node.childNodes) {
    if (containsRetainableMarker(child)) {
      return true;
    }
  }

  return false;
}

function shouldRetainBlockBranch(nodes: Node[]): boolean {
  return nodes.some(containsRetainableMarker);
}

export function hasReactiveComponentProps(props: Record<string, unknown> | null): boolean {
  if (!props) {
    return false;
  }

  for (const key in props) {
    if (
      isDynamic(props[key]) ||
      isAttrBinding(props[key]) ||
      isTextBinding(props[key]) ||
      isNodeFactory(props[key]) ||
      isTemplateFactory(props[key])
    ) {
      return true;
    }
  }

  return false;
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

function materializeNodes(value: unknown): Node[] {
  if (value instanceof Element) {
    return [value];
  }

  const fragment = document.createDocumentFragment();
  appendChild(fragment, value);
  return Array.from(fragment.childNodes);
}

function readSingleRenderableNode(value: unknown, context: string): Node {
  const nodes = materializeNodes(value);

  if (nodes.length === 1) {
    return nodes[0]!;
  }

  if (IS_DEV) {
    console.warn(`[hel] ${context} expects each item to render exactly one root node.`);
  }

  if (nodes.length === 0) {
    return document.createComment("empty");
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
      claimed.data = value;
    }
    return;
  }

  if (currentHydrationFrame(parent)?.current) {
    bailHydration(parent, `text("${value}")`);
  }
  appendNode(parent, document.createTextNode(value));
}

// The compiler cannot always tell text from renderable content (props.children,
// helpers from other modules), so a slot holding an object becomes a block slot.
function mountTextSlot(parent: Node, read: () => unknown): void {
  const owner = getActiveScope();
  let text: Text | null = null;
  let previous = "";
  let upgraded = false;

  effect(() => {
    if (upgraded) {
      return;
    }

    const probe = createScope();
    const value = runWithScope(probe, read);

    if (typeof value === "object" && value !== null) {
      upgraded = true;
      disposeScope(probe);

      if (!text) {
        mountBlockSlot(parent, read);
        return;
      }

      const fragment = document.createDocumentFragment();
      runWithScope(owner, () => mountBlockSlot(fragment, read));
      text.parentNode?.replaceChild(fragment, text);
      return;
    }

    if (!text) {
      const claimed = claimHydrationNode(parent, (node) => node.nodeType === Node.TEXT_NODE) as Text | null;
      if (!claimed && currentHydrationFrame(parent)?.current) {
        bailHydration(parent, "dynamic text");
      }
      text = claimed ?? document.createTextNode("");

      if (!claimed) {
        appendNode(parent, text);
      }

      previous = claimed ? text.data : "";
    }

    const next = normalizeTextValue(value);
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

function mountBlockMarkers(parent: Node): { start: Comment; end: Comment; hydrated: boolean } {
  const frame = currentHydrationFrame(parent);
  const claimed = frame ? claimHydrationNode(parent, (node) => isCommentNode(node, BLOCK_START)) as Comment | null : null;

  if (claimed && frame) {
    const claimedEnd = findBlockEnd(claimed);

    if (claimedEnd) {
      frame.current = claimedEnd.nextSibling as ChildNode | null;
      return { start: claimed, end: claimedEnd, hydrated: true };
    }

    frame.current = claimed;
    bailHydration(parent, `comment(${BLOCK_START}) ... comment(${BLOCK_END})`, null);
  } else if (frame?.current) {
    bailHydration(parent, `comment(${BLOCK_START})`);
  }

  const start = document.createComment(BLOCK_START);
  const end = document.createComment(BLOCK_END);
  appendNode(parent, start);
  appendNode(parent, end);
  return { start, end, hydrated: false };
}

function replaceBlockContent(start: Comment, end: Comment, currentNodes: Node[], nextNodes: Node[]): void {
  const parent = end.parentNode!;

  if (currentNodes.length === 1 && nextNodes.length === 1 && currentNodes[0]!.parentNode === parent) {
    replaceNode(parent, nextNodes[0]!, currentNodes[0]!);
    return;
  }

  replaceNodesBetween(parent, start, end, nextNodes, currentNodes.length);
}

function mountBlockSlot(parent: Node, read: () => unknown): void {
  const { start, end, hydrated: startsHydrated } = mountBlockMarkers(parent);
  let hydrated = startsHydrated;
  let currentNodes: Node[] = [];
  let contentScope: Scope | null = null;
  let retainedBranch: RetainedBlockBranch | null = null;

  onScopeCleanup(() => {
    disposeScope(contentScope);
    if (retainedBranch) {
      disposeScope(retainedBranch.scope);
      retainedBranch = null;
    }
  });

  // Moves the visible content out of the document with its scope still alive,
  // so nested slots keep updating and the branch can be shown again later.
  const stashCurrentBranch = (signature: string): RetainedBlockBranch => {
    const holder = document.createDocumentFragment();
    moveNodesBetween(start, end, holder);
    return { signature, holder, scope: contentScope! };
  };

  effect(() => {
    if (hydrated) {
      contentScope = createScope();
      const blockFrame = openHydrationFrame(end.parentNode!, "block", end);
      if (blockFrame) {
        blockFrame.current = start.nextSibling as ChildNode | null;
      }
      const nextValue = runWithScope(contentScope, () => read());
      runWithScope(contentScope, () => appendChild(end.parentNode!, nextValue));
      flushScopeMounts(contentScope);
      closeHydrationFrame(blockFrame);
      hydrated = false;
      currentNodes = collectNodesBetween(start, end);
      return;
    }

    if (!shouldRetainBlockBranch(currentNodes) && !retainedBranch) {
      const wasStatic = isStaticScope(contentScope);
      disposeScope(contentScope);
      const nextScope = createScope();
      contentScope = nextScope;
      const nextNodes = runWithScope(nextScope, () => materializeNodes(read()));

      if (wasStatic && isStaticScope(nextScope) && tryPatchNodeListInPlace(currentNodes, nextNodes)) {
        currentNodes = currentNodes.slice();
        return;
      }

      replaceBlockContent(start, end, currentNodes, nextNodes);
      flushScopeMounts(nextScope);
      currentNodes = nextNodes;
      return;
    }

    const nextScope = createScope();
    const nextNodes = runWithScope(nextScope, () => materializeNodes(read()));
    const liveNodes = collectNodesBetween(start, end);
    const currentSignature = getNodeListSignature(liveNodes);
    const nextSignature = getNodeListSignature(nextNodes);

    if (currentSignature === nextSignature) {
      // Same shape means a plain re-render, not a switch back to a hidden branch.
      disposeScope(contentScope);
      replaceBlockContent(start, end, liveNodes, nextNodes);
    } else if (retainedBranch && retainedBranch.signature === nextSignature) {
      disposeScope(nextScope);
      const restored: RetainedBlockBranch = retainedBranch;

      if (shouldRetainBlockBranch(liveNodes)) {
        retainedBranch = stashCurrentBranch(currentSignature);
      } else {
        disposeScope(contentScope);
        replaceNodesBetween(end.parentNode!, start, end, [], liveNodes.length);
        retainedBranch = null;
      }

      currentNodes = Array.from(restored.holder.childNodes);
      contentScope = restored.scope;
      insertNodeBefore(end.parentNode!, restored.holder, end);
      return;
    } else if (shouldRetainBlockBranch(liveNodes)) {
      if (retainedBranch) {
        disposeScope(retainedBranch.scope);
      }
      retainedBranch = stashCurrentBranch(currentSignature);
      replaceNodesBetween(end.parentNode!, start, end, nextNodes, 0);
    } else {
      disposeScope(contentScope);
      replaceBlockContent(start, end, liveNodes, nextNodes);
    }

    flushScopeMounts(nextScope);
    currentNodes = nextNodes;
    contentScope = nextScope;
  });
}

type BranchEntry = {
  holder: DocumentFragment;
  scope: Scope;
};

function mountBranchSlot(
  parent: Node,
  binding: {
    when: () => unknown;
    consequent: () => unknown;
    alternate: () => unknown;
  },
): void {
  const { start, end, hydrated: startsHydrated } = mountBlockMarkers(parent);
  let hydrated = startsHydrated;
  let activeKind: "consequent" | "alternate" | null = null;
  const branches: Partial<Record<"consequent" | "alternate", BranchEntry>> = {};

  onScopeCleanup(() => {
    for (const entry of Object.values(branches)) {
      disposeScope(entry?.scope ?? null);
    }
  });

  const materializeBranch = (kind: "consequent" | "alternate"): BranchEntry => {
    const cached = branches[kind];
    if (cached) {
      return cached;
    }

    const entry: BranchEntry = {
      holder: document.createDocumentFragment(),
      scope: createScope(),
    };
    branches[kind] = entry;

    const read = kind === "consequent" ? binding.consequent : binding.alternate;
    runWithScope(entry.scope, () => untrack(() => appendChild(entry.holder, read())));
    return entry;
  };

  effect(() => {
    const nextKind = binding.when() ? "consequent" : "alternate";

    if (hydrated) {
      const scope = createScope();
      const read = nextKind === "consequent" ? binding.consequent : binding.alternate;
      const blockFrame = openHydrationFrame(end.parentNode!, "branch", end);
      if (blockFrame) {
        blockFrame.current = start.nextSibling as ChildNode | null;
      }

      runWithScope(scope, () => untrack(() => appendChild(end.parentNode!, read())));
      flushScopeMounts(scope);
      closeHydrationFrame(blockFrame);

      branches[nextKind] = {
        holder: document.createDocumentFragment(),
        scope,
      };
      activeKind = nextKind;
      hydrated = false;
      return;
    }

    if (activeKind === nextKind) {
      return;
    }

    const nextEntry = materializeBranch(nextKind);

    // The hidden branch keeps its scope and lives in its holder, where nested
    // slots can go on updating until it is shown again.
    if (activeKind) {
      moveNodesBetween(start, end, branches[activeKind]!.holder);
    }

    insertNodeBefore(end.parentNode!, nextEntry.holder, end);
    flushScopeMounts(nextEntry.scope);
    activeKind = nextKind;
  });
}

function mountListSlot<T>(parent: Node, binding: KeyedList<T>): void {
  const { start, end, hydrated: startsHydrated } = mountBlockMarkers(parent);
  let hydrated = startsHydrated;
  let currentEntries: Array<ListEntry<T>> = [];

  onScopeCleanup(() => {
    for (const entry of currentEntries) {
      disposeScope(entry.scope);
    }
  });

  const updateEntry = (entry: ListEntry<T>, item: T, index: number): void => {
    if (entry.item.value !== item) {
      entry.index = index;
      set(entry.item, item);
    }
  };

  effect(() => {
    const items = binding.read();
    const nextKeys = new Array<string | number>(items.length);
    for (let index = 0; index < items.length; index += 1) {
      nextKeys[index] = binding.key(items[index]!, index);
    }

    const parent = end.parentNode!;

    if (hydrated) {
      hydrated = false;

      if (collectNodesBetween(start, end).length !== items.length) {
        warnHydrationMismatch(`list(${items.length})`, start);
      }

      // Rows claim their prerendered nodes, which then move back into place.
      const listFrame = openHydrationFrame(parent, "list", end);
      if (listFrame) {
        listFrame.current = start.nextSibling as ChildNode | null;
      }

      currentEntries = items.map((item, index) => createListEntry(binding, item, index, nextKeys[index]!));
      closeHydrationFrame(listFrame);
      insertNodesBefore(parent, currentEntries.map((entry) => entry.node), end);
      return;
    }

    if (currentEntries.length === 0) {
      if (items.length === 0) {
        return;
      }

      const nextEntries: Array<ListEntry<T>> = [];
      const freshNodes: Node[] = [];

      for (let index = 0; index < items.length; index += 1) {
        const entry = createListEntry(binding, items[index]!, index, nextKeys[index]!);
        freshNodes.push(entry.node);
        nextEntries.push(entry);
      }

      insertNodesBefore(parent, freshNodes, end);
      currentEntries = nextEntries;
      return;
    }

    if (currentEntries.length === items.length) {
      let stableOrder = true;

      for (let index = 0; index < items.length; index += 1) {
        if (currentEntries[index]!.key !== nextKeys[index]!) {
          stableOrder = false;
          break;
        }
      }

      if (stableOrder) {
        for (let index = 0; index < items.length; index += 1) {
          updateEntry(currentEntries[index]!, items[index]!, index);
        }
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
      const key = nextKeys[index]!;
      const previous = previousByKey.get(key);
      previousByKey.delete(key);

      if (previous) {
        updateEntry(previous, item, index);
        nextEntries.push(previous);
        continue;
      }

      nextEntries.push(createListEntry(binding, item, index, key));
    }

    for (const entry of previousByKey.values()) {
      if (entry.node.parentNode === parent) {
        removeNode(parent, entry.node);
      }
      disposeScope(entry.scope);
    }

    let anchor: Node = start;
    let pendingInsertions: Node[] = [];
    let pendingReference: Node | null = end;

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
        pendingReference = expectedNextSibling ?? end;
      } else {
        flushPendingInsertions();
        insertNodeBefore(parent, entry.node, expectedNextSibling ?? end);
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
  if (isComponentResult(value)) {
    appendChild(parent, value.value);
    flushScopeMounts(value.scope);
    return;
  }

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

  if (isBranchBinding(value)) {
    mountBranchSlot(parent, value);
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

  if (key === "ref") {
    if (isRefBinding(value)) {
      value.assign(element);
      return;
    }

    if (typeof value === "function") {
      value(element);
      return;
    }
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
