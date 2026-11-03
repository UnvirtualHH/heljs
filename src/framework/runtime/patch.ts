import { runtimeStats } from "./core";

const IS_DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

// A click handler sits directly on the element, because a list has one per row.
type EventHost = HTMLElement & {
  $click?: EventListener;
  $events?: Record<string, EventListener>;
};

function isInstanceOf<T>(value: unknown, ctorName: "HTMLInputElement" | "HTMLTextAreaElement" | "HTMLSelectElement" | "HTMLOptionElement"): value is T {
  const ctor = (globalThis as Record<string, unknown>)[ctorName];
  return typeof ctor === "function" && value instanceof (ctor as typeof Element);
}

let delegatingClicks = false;

// A list with a click handler per row would otherwise pay for every listener twice:
// when it is added, and when the row is removed. The walk reproduces what bubbling
// would do, so a handler sees the same currentTarget and can stop the event.
function delegateClick(event: Event): void {
  let node = event.target as (Node & { $click?: EventListener; disabled?: boolean; host?: Node }) | null;

  while (node) {
    const handler = node.$click;

    if (handler && !node.disabled) {
      const currentTarget = node;
      Object.defineProperty(event, "currentTarget", { configurable: true, get: () => currentTarget });

      try {
        handler.call(node, event);
      } catch (error) {
        reportError(error);
      }

      if (event.cancelBubble) {
        return;
      }
    }

    node = (node.parentNode ?? node.host ?? null) as typeof node;
  }
}

// Called early by the router: its own listener has to run after the handlers,
// which is the order it would see if they were on the elements themselves.
export function delegateClicks(): void {
  if (!delegatingClicks && typeof document !== "undefined") {
    delegatingClicks = true;
    document.addEventListener("click", delegateClick);
  }
}

export function bindEvent(element: HTMLElement, key: string, listener: EventListener): void {
  const host = element as EventHost;
  const eventName = key.slice(2).toLowerCase();

  if (eventName === "click") {
    delegateClicks();
    host.$click = listener;
    return;
  }

  const bindings = (host.$events ??= {});
  const previous = bindings[eventName];

  if (previous === listener) {
    return;
  }

  if (previous) {
    element.removeEventListener(eventName, previous);
  }

  element.addEventListener(eventName, listener);
  bindings[eventName] = listener;
}

function syncEventBindings(current: HTMLElement, next: HTMLElement): void {
  (current as EventHost).$click = (next as EventHost).$click;

  const currentBindings = (current as EventHost).$events;
  const nextBindings = (next as EventHost).$events;

  if (!currentBindings && !nextBindings) {
    return;
  }

  if (currentBindings) {
    for (const eventName in currentBindings) {
      if (!nextBindings?.[eventName]) {
        current.removeEventListener(eventName, currentBindings[eventName]!);
        delete currentBindings[eventName];
      }
    }
  }

  if (nextBindings) {
    for (const eventName in nextBindings) {
      bindEvent(current, `on${eventName}`, nextBindings[eventName]!);
    }
  }
}

function syncAttributes(current: HTMLElement, next: HTMLElement): void {
  if (current.attributes.length === 0 && next.attributes.length === 0) {
    return;
  }

  const nextNames = next.getAttributeNames();
  const nextNameSet = new Set(nextNames);

  const currentNames = current.getAttributeNames();
  for (let i = 0; i < currentNames.length; i += 1) {
    const name = currentNames[i]!;
    if (!nextNameSet.has(name)) {
      current.removeAttribute(name);
      if (IS_DEV) runtimeStats.attrPatches += 1;
    }
  }

  for (let i = 0; i < nextNames.length; i += 1) {
    const name = nextNames[i]!;
    const nextValue = next.getAttribute(name);
    if (current.getAttribute(name) !== nextValue) {
      if (nextValue === null) {
        current.removeAttribute(name);
      } else {
        current.setAttribute(name, nextValue);
      }
      if (IS_DEV) runtimeStats.attrPatches += 1;
    }
  }
}

function syncSpecialElementState(current: HTMLElement, next: HTMLElement): void {
  if (isInstanceOf<HTMLInputElement>(current, "HTMLInputElement") && isInstanceOf<HTMLInputElement>(next, "HTMLInputElement")) {
    if (current.value !== next.value) {
      current.value = next.value;
    }

    if (current.checked !== next.checked) {
      current.checked = next.checked;
    }

    return;
  }

  if (isInstanceOf<HTMLTextAreaElement>(current, "HTMLTextAreaElement") && isInstanceOf<HTMLTextAreaElement>(next, "HTMLTextAreaElement")) {
    if (current.value !== next.value) {
      current.value = next.value;
    }

    return;
  }

  if (isInstanceOf<HTMLSelectElement>(current, "HTMLSelectElement") && isInstanceOf<HTMLSelectElement>(next, "HTMLSelectElement")) {
    if (current.value !== next.value) {
      current.value = next.value;
    }

    return;
  }

  if (isInstanceOf<HTMLOptionElement>(current, "HTMLOptionElement") && isInstanceOf<HTMLOptionElement>(next, "HTMLOptionElement")) {
    if (current.selected !== next.selected) {
      current.selected = next.selected;
    }
  }
}

function hasEventBindings(element: HTMLElement): boolean {
  if ((element as EventHost).$click) {
    return true;
  }

  const bindings = (element as EventHost).$events;

  for (const _eventName in bindings) {
    return true;
  }

  return false;
}

function needsSpecialStateSync(current: HTMLElement, next: HTMLElement): boolean {
  return (
    (isInstanceOf<HTMLInputElement>(current, "HTMLInputElement") && isInstanceOf<HTMLInputElement>(next, "HTMLInputElement")) ||
    (isInstanceOf<HTMLTextAreaElement>(current, "HTMLTextAreaElement") && isInstanceOf<HTMLTextAreaElement>(next, "HTMLTextAreaElement")) ||
    (isInstanceOf<HTMLSelectElement>(current, "HTMLSelectElement") && isInstanceOf<HTMLSelectElement>(next, "HTMLSelectElement")) ||
    (isInstanceOf<HTMLOptionElement>(current, "HTMLOptionElement") && isInstanceOf<HTMLOptionElement>(next, "HTMLOptionElement"))
  );
}

export function canPatchNodeInPlace(current: Node, next: Node): boolean {
  if (current.nodeType !== next.nodeType) {
    return false;
  }

  if (current.nodeType === Node.TEXT_NODE) {
    return true;
  }

  if (current.nodeType === Node.COMMENT_NODE) {
    return true;
  }

  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
    return false;
  }

  if (current.tagName !== next.tagName) {
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

export function patchNodeInPlace(current: Node, next: Node): void {
  if (current.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
    const currentText = current as Text;
    const nextText = next as Text;
    if (currentText.data !== nextText.data) {
      currentText.data = nextText.data;
      if (IS_DEV) runtimeStats.textPatches += 1;
    }
    return;
  }

  if (current.nodeType === Node.COMMENT_NODE) {
    return;
  }

  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
    return;
  }

  if (IS_DEV) runtimeStats.inPlacePatches += 1;
  syncEventBindings(current, next);
  syncAttributes(current, next);

  for (let index = 0; index < current.childNodes.length; index += 1) {
    patchNodeInPlace(current.childNodes[index]!, next.childNodes[index]!);
  }

  syncSpecialElementState(current, next);
}

function patchNodeInPlaceIfPossible(current: Node, next: Node): boolean {
  if (current.nodeType !== next.nodeType) {
    return false;
  }

  if (current.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
    const currentText = current as Text;
    const nextText = next as Text;
    if (currentText.data !== nextText.data) {
      currentText.data = nextText.data;
      if (IS_DEV) runtimeStats.textPatches += 1;
    }
    return true;
  }

  if (current.nodeType === Node.COMMENT_NODE && next.nodeType === Node.COMMENT_NODE) {
    return true;
  }

  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
    return false;
  }

  if (current.tagName !== next.tagName || current.childNodes.length !== next.childNodes.length) {
    return false;
  }

  const specialState = needsSpecialStateSync(current, next);
  const currentHasEvents = hasEventBindings(current);
  const nextHasEvents = hasEventBindings(next);
  const hasAttributes = current.attributes.length !== 0 || next.attributes.length !== 0;
  const canFastPatchLeaf =
    !specialState &&
    !currentHasEvents &&
    !nextHasEvents &&
    !hasAttributes &&
    current.childNodes.length === 1 &&
    current.firstChild?.nodeType === Node.TEXT_NODE &&
    next.firstChild?.nodeType === Node.TEXT_NODE;

  if (canFastPatchLeaf) {
    if (IS_DEV) runtimeStats.inPlacePatches += 1;
    const currentText = current.firstChild as Text;
    const nextText = next.firstChild as Text;
    if (currentText.data !== nextText.data) {
      currentText.data = nextText.data;
      if (IS_DEV) runtimeStats.textPatches += 1;
    }
    return true;
  }

  if (IS_DEV) runtimeStats.inPlacePatches += 1;
  const canFastPatchContainer = !specialState && !currentHasEvents && !nextHasEvents && !hasAttributes;

  if (!canFastPatchContainer) {
    syncEventBindings(current, next);
    syncAttributes(current, next);
  }

  for (let index = 0; index < current.childNodes.length; index += 1) {
    if (!patchNodeInPlaceIfPossible(current.childNodes[index]!, next.childNodes[index]!)) {
      return false;
    }
  }

  if (!canFastPatchContainer && specialState) {
    syncSpecialElementState(current, next);
  }
  return true;
}

export function tryPatchNodeInPlace(current: Node, next: Node): boolean {
  return patchNodeInPlaceIfPossible(current, next);
}

export function tryPatchNodeListInPlace(currentNodes: Node[], nextNodes: Node[]): boolean {
  if (currentNodes.length !== nextNodes.length) {
    return false;
  }

  for (let index = 0; index < currentNodes.length; index += 1) {
    if (!patchNodeInPlaceIfPossible(currentNodes[index]!, nextNodes[index]!)) {
      return false;
    }
  }

  return true;
}

export function canPatchNodeListInPlace(currentNodes: Node[], nextNodes: Node[]): boolean {
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
