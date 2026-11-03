import {
  cell,
  createScope,
  disposeScope,
  flushScopeMounts,
  createEffect,
  disposeEffect,
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
  runProbed,
  type EffectNode,
  type Scope,
} from "./core";
import type { ComponentResult } from "./component";
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
  type HydrationFrame,
} from "./hydration";
import {
  appendNode,
  cloneTemplate,
  insertNodeBefore,
  insertNodesBefore,
  removeNode,
  replaceNode,
  replaceNodesBetween,
} from "./dom";
import {
  bindEvent,
  tryPatchNodeInPlace,
  tryPatchNodeListInPlace,
} from "./patch";
import {
  BRANCH,
  COMPONENT_RESULT,
  DYNAMIC,
  isLiveRow,
  isThenable,
  LIST,
  NODE_FACTORY,
  RENDERED_PROMISE_MESSAGE,
  TEMPLATE_FACTORY,
  TEXT_BINDING,
  type BranchBinding,
  type Dynamic,
  type KeyedList,
  type NodeFactory,
  type TemplateFactory,
  type TextBinding,
} from "../shared";

type ListEntry<T> = {
  item: Cell<T>;
  index: number;
  indexCell: Cell<number> | null;
  position: number;
  key: string | number;
  node: Node;
  effect: EffectNode | null;
  content: Scope | null;
};

function disposeEntry<T>(entry: ListEntry<T>): void {
  if (entry.effect) {
    disposeEffect(entry.effect);
  }
  disposeScope(entry.content);
}

const IS_DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

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
    indexCell: null,
    position: -1,
    key,
    node: null as unknown as Node,
    effect: null,
    content: null,
  };
  const render = binding.render;
  const renderRow = isLiveRow<T>(render)
    ? () =>
        render(
          () => get(entry.item),
          () => get((entry.indexCell ??= cell(entry.index))),
          entry.key,
        )
    : () => render(get(entry.item), entry.index);

  try {
    const effect = createEffect(() => {
      const wasStatic = isStaticScope(entry.content);
      disposeScope(entry.content);

      const nextScope = createScope();
      entry.content = nextScope;
      const previous = entry.node;
      let node: Node;

      try {
        node = runWithScope(nextScope, () => readSingleRenderableNode(renderRow(), "list()"));
      } catch (error) {
        // The old row is disposed, so keeping it on screen would show dead content.
        if (previous?.parentNode) {
          entry.node = document.createComment("error");
          replaceNode(previous.parentNode, entry.node, previous);
        }
        throw error;
      }

      flushScopeMounts(nextScope);

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
    }, false);

    // A row that read nothing while rendering can never render again.
    entry.effect = effect.deps === null ? null : effect;
  } catch (error) {
    disposeScope(entry.content);
    throw error;
  }

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

// While hydrating, the cursor marks the position. The end of the parent can
// already hold prerendered siblings, and closing the frame would remove the node.
function placeNode(parent: Node, node: Node): void {
  const frame = currentHydrationFrame(parent);

  if (frame) {
    insertNodeBefore(parent, node, frame.current);
    return;
  }

  appendNode(parent, node);
}

// The HTML parser merges adjacent text, so one server text node can hold several
// slots. Each slot takes its own part, and leaves the rest for the next one.
function claimTextPart(frame: HydrationFrame, value: string): Text | null {
  const next = frame.current;

  if (!value || !next || next === frame.boundary || next.nodeType !== Node.TEXT_NODE || !(next as Text).data.startsWith(value)) {
    return null;
  }

  const text = next as Text;
  frame.current = text.data.length > value.length ? text.splitText(value.length) : (text.nextSibling as ChildNode | null);
  return text;
}

function claimText(parent: Node, value: string): Text | null {
  const frame = currentHydrationFrame(parent);

  return (
    (frame && claimTextPart(frame, value)) ??
    (claimHydrationNode(parent, (node) => node.nodeType === Node.TEXT_NODE) as Text | null)
  );
}

function mountStaticText(parent: Node, value: string): void {
  const frame = currentHydrationFrame(parent);

  // Whitespace can be missing on the server's side, which is not a mismatch.
  if (frame && !value.trim()) {
    if (value && !claimTextPart(frame, value)) {
      placeNode(parent, document.createTextNode(value));
    }
    return;
  }

  const claimed = claimText(parent, value);
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
  placeNode(parent, document.createTextNode(value));
}

// The compiler cannot always tell text from renderable content (props.children,
// helpers from other modules), so a slot holding an object becomes a block slot.
function mountTextSlot(parent: Node, read: () => unknown, placeholder: Text | null = null): void {
  const owner = getActiveScope();
  let text = placeholder;
  let previous = placeholder ? placeholder.data : "";
  let upgraded = false;

  createEffect(() => {
    if (upgraded) {
      return;
    }

    let value: unknown;

    try {
      value = runProbed(read);
    } catch (error) {
      // The last value is no longer true, and the slot retries on its next change.
      if (text) {
        text.data = "";
        previous = "";
      }
      throw error;
    }

    if (typeof value === "object" && value !== null) {
      upgraded = true;

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
      const initial = normalizeTextValue(value);
      // An empty value leaves no text on the server's side, so there is nothing to claim.
      const claimed = initial ? claimText(parent, initial) : null;
      if (initial && !claimed && currentHydrationFrame(parent)?.current) {
        bailHydration(parent, "dynamic text");
      }
      text = claimed ?? document.createTextNode("");

      if (!claimed) {
        placeNode(parent, text);
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
  mountTextSlot(parent, () => get(cell));
}

export function fillTextPlaceholder(parent: Node, text: Text, value: unknown): void {
  if (typeof value !== "object" || value === null) {
    text.data = normalizeTextValue(value);
    return;
  }

  const tag = (value as { $t?: number }).$t;

  if (tag === DYNAMIC && (value as Dynamic).kind === "text") {
    mountTextSlot(parent, (value as Dynamic).read, text);
    return;
  }

  if (tag === TEXT_BINDING) {
    const { cell } = value as TextBinding;
    mountTextSlot(parent, () => get(cell as Cell<unknown>), text);
    return;
  }

  const holder = document.createDocumentFragment();
  appendChild(holder, value);
  parent.replaceChild(holder, text);
}

function unwrapAttrValue(value: unknown): unknown {
  return isDynamic(value) ? unwrapAttrValue(value.read()) : value;
}

function matchesHydratedProperty(element: HTMLElement, key: string, value: unknown): boolean {
  const normalizedKey = key === "className" ? "class" : key;
  const isDomProperty =
    normalizedKey in element &&
    !normalizedKey.startsWith("data-") &&
    !normalizedKey.startsWith("aria-");

  if (normalizedKey === "class") {
    return (element.getAttribute("class") ?? "") === normalizeTextValue(value);
  }

  // What the server rendered for a select is the option it marked as selected.
  if (normalizedKey === "value" && element instanceof HTMLSelectElement) {
    return element.querySelector("option[selected]")?.getAttribute("value") === String(value ?? "");
  }

  // Properties can differ from what was rendered: href reads as an absolute URL.
  if (typeof value === "string" && element.getAttribute(normalizedKey) === value) {
    return true;
  }

  if (isDomProperty && !(element instanceof SVGElement)) {
    const current = (element as unknown as Record<string, unknown>)[normalizedKey];

    if (typeof current === "boolean") {
      return current === Boolean(value);
    }

    if (value == null) {
      return current === "";
    }

    // An input's value is always a string, also when it is rendered from a number.
    return typeof current === "string" && typeof value === "number" ? current === String(value) : Object.is(current, value);
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

  if (normalizedKey === "class") {
    if (value == null || value === false) {
      element.removeAttribute("class");
    } else if (typeof element.className === "string") {
      element.className = String(value);
    } else {
      // On an SVG element, className is a read-only object.
      element.setAttribute("class", String(value));
    }
    return;
  }

  const isDomProperty =
    normalizedKey in element &&
    !normalizedKey.startsWith("data-") &&
    !normalizedKey.startsWith("aria-");

  if (normalizedKey === "style" && value && typeof value === "object") {
    Object.assign(element.style, value);
    return;
  }

  // Most properties of an SVG element are read-only objects.
  if (isDomProperty && !(element instanceof SVGElement)) {
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

    target[normalizedKey] = typeof value === "number" && typeof current === "string" ? String(value) : value;
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

  createEffect(() => {
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
  placeNode(parent, start);
  placeNode(parent, end);
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

  onScopeCleanup(() => disposeScope(contentScope));

  createEffect(() => {
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

    const wasStatic = isStaticScope(contentScope);
    disposeScope(contentScope);
    const nextScope = createScope();
    contentScope = nextScope;
    let nextNodes: Node[];

    try {
      nextNodes = runWithScope(nextScope, () => materializeNodes(read()));
    } catch (error) {
      // The old content is disposed, so keeping it on screen would show dead slots.
      replaceBlockContent(start, end, collectNodesBetween(start, end), []);
      currentNodes = [];
      throw error;
    }

    if (wasStatic && isStaticScope(nextScope) && tryPatchNodeListInPlace(currentNodes, nextNodes)) {
      currentNodes = currentNodes.slice();
      return;
    }

    replaceBlockContent(start, end, collectNodesBetween(start, end), nextNodes);
    flushScopeMounts(nextScope);
    currentNodes = nextNodes;
  });
}

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
  let activeScope: Scope | null = null;

  onScopeCleanup(() => disposeScope(activeScope));

  createEffect(() => {
    const nextKind = binding.when() ? "consequent" : "alternate";

    if (!hydrated && activeKind === nextKind) {
      return;
    }

    const read = nextKind === "consequent" ? binding.consequent : binding.alternate;
    const scope = createScope();

    if (hydrated) {
      activeKind = nextKind;
      activeScope = scope;
      const blockFrame = openHydrationFrame(end.parentNode!, "branch", end);
      if (blockFrame) {
        blockFrame.current = start.nextSibling as ChildNode | null;
      }

      runWithScope(scope, () => untrack(() => appendChild(end.parentNode!, read())));
      flushScopeMounts(scope);
      closeHydrationFrame(blockFrame);
      hydrated = false;
      return;
    }

    disposeScope(activeScope);
    activeScope = scope;

    const holder = document.createDocumentFragment();

    try {
      runWithScope(scope, () => untrack(() => appendChild(holder, read())));
    } catch (error) {
      // No kind is active now, so the next change renders again instead of
      // assuming that the arm it selects is already on screen.
      activeKind = null;
      replaceNodesBetween(end.parentNode!, start, end, [], collectNodesBetween(start, end).length);
      throw error;
    }

    activeKind = nextKind;
    replaceNodesBetween(
      end.parentNode!,
      start,
      end,
      Array.from(holder.childNodes),
      collectNodesBetween(start, end).length,
    );
    flushScopeMounts(scope);
  });
}

// The longest run of rows already in order stays where it is, and only the others
// move. Swapping two rows then moves two nodes, not everything between them.
function markStableRows(positions: number[]): boolean[] {
  const previous = new Array<number>(positions.length);
  const tails: number[] = [];

  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index]!;
    if (position < 0) {
      continue;
    }

    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (positions[tails[middle]!]! < position) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    previous[index] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = index;
  }

  const stable = new Array<boolean>(positions.length).fill(false);
  let cursor = tails.length > 0 ? tails[tails.length - 1]! : -1;

  while (cursor >= 0) {
    stable[cursor] = true;
    cursor = previous[cursor]!;
  }

  return stable;
}

function mountListSlot<T>(parent: Node, binding: KeyedList<T>): void {
  const { start, end, hydrated: startsHydrated } = mountBlockMarkers(parent);
  let hydrated = startsHydrated;
  let currentEntries: Array<ListEntry<T>> = [];
  let created: Array<ListEntry<T>> = [];

  onScopeCleanup(() => {
    for (const entry of currentEntries) {
      disposeEntry(entry);
    }
  });

  const createEntry = (item: T, index: number, key: string | number): ListEntry<T> => {
    const entry = createListEntry(binding, item, index, key);
    created.push(entry);
    return entry;
  };

  const updateEntry = (entry: ListEntry<T>, item: T, index: number): void => {
    entry.index = index;

    if (entry.indexCell) {
      set(entry.indexCell, index);
    }

    if (entry.item.value !== item) {
      set(entry.item, item);
    }
  };

  const update = (): void => {
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

      currentEntries = items.map((item, index) => createEntry(item, index, nextKeys[index]!));
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
        const entry = createEntry(items[index]!, index, nextKeys[index]!);
        freshNodes.push(entry.node);
        nextEntries.push(entry);
      }

      insertNodesBefore(parent, freshNodes, end);
      currentEntries = nextEntries;
      return;
    }

    if (items.length === 0) {
      replaceNodesBetween(parent, start, end, [], currentEntries.length);
      for (const entry of currentEntries) {
        disposeEntry(entry);
      }
      currentEntries = [];
      return;
    }

    // Most changes leave both ends alone: appending, removing one row, swapping two.
    const oldLength = currentEntries.length;
    const newLength = items.length;
    let head = 0;

    while (head < oldLength && head < newLength && currentEntries[head]!.key === nextKeys[head]) {
      updateEntry(currentEntries[head]!, items[head]!, head);
      head += 1;
    }

    if (head === oldLength && head === newLength) {
      return;
    }

    let oldTail = oldLength - 1;
    let newTail = newLength - 1;

    while (oldTail >= head && newTail >= head && currentEntries[oldTail]!.key === nextKeys[newTail]) {
      updateEntry(currentEntries[oldTail]!, items[newTail]!, newTail);
      oldTail -= 1;
      newTail -= 1;
    }

    const nextEntries = new Array<ListEntry<T>>(newLength);

    for (let index = 0; index < head; index += 1) {
      nextEntries[index] = currentEntries[index]!;
    }

    for (let index = newTail + 1; index < newLength; index += 1) {
      nextEntries[index] = currentEntries[index - newLength + oldLength]!;
    }

    const reference: Node = newTail + 1 < newLength ? nextEntries[newTail + 1]!.node : end;

    if (oldTail < head) {
      const freshNodes: Node[] = [];

      for (let index = head; index <= newTail; index += 1) {
        const entry = createEntry(items[index]!, index, nextKeys[index]!);
        nextEntries[index] = entry;
        freshNodes.push(entry.node);
      }

      insertNodesBefore(parent, freshNodes, reference);
      currentEntries = nextEntries;
      return;
    }

    if (newTail < head) {
      for (let index = head; index <= oldTail; index += 1) {
        const entry = currentEntries[index]!;
        if (entry.node.parentNode === parent) {
          removeNode(parent, entry.node);
        }
        disposeEntry(entry);
      }

      currentEntries = nextEntries;
      return;
    }

    const previousByKey = new Map<string | number, ListEntry<T>>();

    for (let position = head; position <= oldTail; position += 1) {
      const entry = currentEntries[position]!;
      if (previousByKey.has(entry.key) && IS_DEV) {
        console.warn(`[hel] Duplicate key "${String(entry.key)}" in keyed list.`);
      }
      entry.position = position;
      previousByKey.set(entry.key, entry);
    }

    const positions = new Array<number>(newTail - head + 1);

    for (let index = head; index <= newTail; index += 1) {
      const key = nextKeys[index]!;
      const previous = previousByKey.get(key);

      if (previous) {
        previousByKey.delete(key);
        updateEntry(previous, items[index]!, index);
        nextEntries[index] = previous;
        positions[index - head] = previous.position;
      } else {
        nextEntries[index] = createEntry(items[index]!, index, key);
        positions[index - head] = -1;
      }
    }

    // When no row survives, the old ones go at once instead of one by one.
    if (previousByKey.size === oldLength) {
      replaceNodesBetween(parent, start, end, [], oldLength);
      for (const entry of currentEntries) {
        disposeEntry(entry);
      }
    } else {
      for (const entry of previousByKey.values()) {
        if (entry.node.parentNode === parent) {
          removeNode(parent, entry.node);
        }
        disposeEntry(entry);
      }
    }

    // From the back, so the node after the current one is already in its place.
    const stable = markStableRows(positions);
    let anchor = reference;
    let pending: Node[] = [];

    for (let index = newTail; index >= head; index -= 1) {
      const node = nextEntries[index]!.node;

      if (!stable[index - head]) {
        pending.push(node);
        continue;
      }

      insertNodesBefore(parent, pending.reverse(), anchor);
      pending = [];
      anchor = node;
    }

    insertNodesBefore(parent, pending.reverse(), anchor);
    currentEntries = nextEntries;
  };

  createEffect(() => {
    created = [];

    try {
      update();
    } catch (error) {
      // The list stays as it was, so rows created for this update have no owner.
      for (const entry of created) {
        disposeEntry(entry);
      }
      throw error;
    }
  });
}

function mountAttrSlot(element: HTMLElement, key: string, read: () => unknown): void {
  let initialized = false;
  let previous: unknown;
  let hydrated = isHydrating();

  createEffect(() => {
    const next = unwrapAttrValue(read());

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
  if (value == null || value === false || value === true) {
    return;
  }

  if (typeof value !== "object") {
    mountStaticText(parent, String(value));
    return;
  }

  switch ((value as { $t?: number }).$t) {
    case COMPONENT_RESULT: {
      const result = value as ComponentResult;
      appendChild(parent, result.value);
      flushScopeMounts(result.scope);
      return;
    }
    case NODE_FACTORY:
      appendChild(parent, (value as NodeFactory).read());
      return;
    case TEXT_BINDING:
      mountTextBinding(parent, (value as TextBinding).cell as Cell<unknown>);
      return;
    case TEMPLATE_FACTORY:
      if (isHydrating()) {
        appendChild(parent, (value as TemplateFactory).read());
        return;
      }

      appendNode(parent, cloneTemplate((value as TemplateFactory).html));
      return;
    case BRANCH:
      mountBranchSlot(parent, value as BranchBinding);
      return;
    case LIST:
      mountListSlot(parent, value as KeyedList<unknown>);
      return;
    case DYNAMIC:
      if ((value as Dynamic).kind === "text") {
        mountTextSlot(parent, (value as Dynamic).read);
        return;
      }

      mountBlockSlot(parent, (value as Dynamic).read);
      return;
  }

  if (value instanceof Node) {
    if (value.parentNode !== parent) {
      placeNode(parent, value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendChild(parent, item);
    }
    return;
  }

  if (isThenable(value)) {
    throw new Error(RENDERED_PROMISE_MESSAGE);
  }

  mountStaticText(parent, String(value));
}

function shouldDeferProperty(element: HTMLElement, key: string): boolean {
  return key === "value" && element instanceof HTMLSelectElement;
}

export function applyProp(element: HTMLElement, key: string, value: unknown): void {
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

export function applyProps(element: HTMLElement, props: Record<string, unknown>): Array<() => void> | null {
  let deferred: Array<() => void> | null = null;

  for (const key in props) {
    const value = props[key];

    if (shouldDeferProperty(element, key)) {
      (deferred ??= []).push(() => applyProp(element, key, value));
      continue;
    }

    applyProp(element, key, value);
  }

  return deferred;
}
