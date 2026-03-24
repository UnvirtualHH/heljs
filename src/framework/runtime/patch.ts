import { runtimeStats } from "./core";

const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
const eventBindings = new WeakMap<HTMLElement, Map<string, EventListener>>();

function isInstanceOf<T>(value: unknown, ctorName: "HTMLInputElement" | "HTMLTextAreaElement" | "HTMLSelectElement" | "HTMLOptionElement"): value is T {
  const ctor = (globalThis as Record<string, unknown>)[ctorName];
  return typeof ctor === "function" && value instanceof (ctor as typeof Element);
}

export function bindEvent(element: HTMLElement, key: string, listener: EventListener): void {
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

function syncEventBindings(current: HTMLElement, next: HTMLElement): void {
  const currentBindings = eventBindings.get(current);
  const nextBindings = eventBindings.get(next);

  if (!currentBindings && !nextBindings) {
    return;
  }

  if (currentBindings) {
    for (const [key, listener] of currentBindings.entries()) {
      if (!nextBindings?.has(key)) {
        current.removeEventListener(key.slice(2).toLowerCase(), listener);
        currentBindings.delete(key);
      }
    }
  }

  if (nextBindings) {
    for (const [key, listener] of nextBindings.entries()) {
      bindEvent(current, key, listener);
    }
  }
}

function syncAttributes(current: HTMLElement, next: HTMLElement): void {
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

export function canPatchNodeInPlace(current: Node, next: Node): boolean {
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

/**
 * Single-pass: check patchability and patch in one traversal.
 * Returns true if patched successfully, false if structures are incompatible.
 */
export function tryPatchNodeInPlace(current: Node, next: Node): boolean {
  if (current.nodeType !== next.nodeType) {
    return false;
  }

  if (current.nodeType === Node.TEXT_NODE) {
    const currentText = current as Text;
    const nextText = next as Text;
    if (currentText.data !== nextText.data) {
      currentText.data = nextText.data;
      if (IS_DEV) runtimeStats.textPatches += 1;
    }
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
    if (!tryPatchNodeInPlace(current.childNodes[index]!, next.childNodes[index]!)) {
      return false;
    }
  }

  if (IS_DEV) runtimeStats.inPlacePatches += 1;
  syncEventBindings(current, next);
  syncAttributes(current, next);
  syncSpecialElementState(current, next);
  return true;
}

export function tryPatchNodeListInPlace(currentNodes: Node[], nextNodes: Node[]): boolean {
  if (currentNodes.length !== nextNodes.length) {
    return false;
  }

  for (let index = 0; index < currentNodes.length; index += 1) {
    if (!tryPatchNodeInPlace(currentNodes[index]!, nextNodes[index]!)) {
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
