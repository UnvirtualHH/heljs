import { runtimeStats } from "./runtime-core";

const eventBindings = new WeakMap<HTMLElement, Map<string, EventListener>>();

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

function syncSpecialElementState(current: HTMLElement, next: HTMLElement): void {
  if (current instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    if (current.value !== next.value) {
      current.value = next.value;
    }

    if (current.checked !== next.checked) {
      current.checked = next.checked;
    }

    return;
  }

  if (current instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
    if (current.value !== next.value) {
      current.value = next.value;
    }

    return;
  }

  if (current instanceof HTMLSelectElement && next instanceof HTMLSelectElement) {
    if (current.value !== next.value) {
      current.value = next.value;
    }

    return;
  }

  if (current instanceof HTMLOptionElement && next instanceof HTMLOptionElement) {
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
      runtimeStats.textPatches += 1;
    }
    return;
  }

  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) {
    return;
  }

  runtimeStats.inPlacePatches += 1;
  syncEventBindings(current, next);
  syncAttributes(current, next);

  for (let index = 0; index < current.childNodes.length; index += 1) {
    patchNodeInPlace(current.childNodes[index]!, next.childNodes[index]!);
  }

  syncSpecialElementState(current, next);
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
