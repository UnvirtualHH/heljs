import { BLOCK_END, BLOCK_START } from "./shared";
import { runtimeStats } from "./runtime-core";

export type HydrationFrame = {
  parent: Node;
  current: ChildNode | null;
  boundary: ChildNode | null;
  label: string;
};

const IS_DEV = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

const hydrationStack: HydrationFrame[] = [];
const hydratedRoots = new WeakSet<Element>();

function removeNode(parent: Node, node: Node): void {
  parent.removeChild(node);
  if (parent.isConnected) {
    runtimeStats.domRemovals += 1;
  }
}

export function isHydrating(): boolean {
  return hydrationStack.length > 0;
}

export function currentHydrationFrame(parent?: Node): HydrationFrame | null {
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

export function warnHydrationMismatch(expected: string, actual: Node | null): void {
  if (!IS_DEV) {
    return;
  }

  console.warn(
    `[hel] Hydration mismatch at ${hydrationPath(expected)}. Expected ${expected}, found ${describeNode(actual)}.`,
  );
}

export function skipIgnorableNodes(frame: HydrationFrame): void {
  while (
    frame.current &&
    frame.current !== frame.boundary &&
    frame.current.nodeType === Node.TEXT_NODE &&
    (frame.current as Text).data.trim() === ""
  ) {
    frame.current = frame.current.nextSibling as ChildNode | null;
  }
}

export function claimHydrationNode(
  parent: Node,
  predicate: (node: ChildNode) => boolean,
): ChildNode | null {
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

export function bailHydration(parent: Node, expected: string, actual?: Node | null): void {
  const frame = currentHydrationFrame(parent);
  if (!frame) {
    return;
  }

  warnHydrationMismatch(expected, actual ?? frame.current);
  clearRemainingHydrationNodes(frame);
}

export function openHydrationFrame(
  parent: Node,
  label: string,
  boundary: ChildNode | null = null,
): HydrationFrame | null {
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

export function closeHydrationFrame(frame: HydrationFrame | null): void {
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

export function clearRemainingHydrationNodes(frame: HydrationFrame): void {
  while (frame.current && frame.current !== frame.boundary) {
    const node = frame.current;
    frame.current = node.nextSibling as ChildNode | null;
    removeNode(frame.parent, node);
  }
}

export function isCommentNode(node: Node | null, data: string): node is Comment {
  return Boolean(node && node.nodeType === Node.COMMENT_NODE && (node as Comment).data === data);
}

export function collectNodesBetween(start: Comment, end: Comment): Node[] {
  const nodes: Node[] = [];
  let current = start.nextSibling;

  while (current && current !== end) {
    nodes.push(current);
    current = current.nextSibling;
  }

  return nodes;
}

export function resetHydrationState(): void {
  hydrationStack.length = 0;
}

export function hasHydratedRoot(target: Element): boolean {
  return hydratedRoots.has(target);
}

export function markHydratedRoot(target: Element): void {
  hydratedRoots.add(target);
}

export function beginRootHydration(target: Element): void {
  hydrationStack.length = 0;
  hydrationStack.push({
    parent: target,
    current: target.firstChild,
    boundary: null,
    label: "#app",
  });
}

export function finalizeRootHydration(): void {
  const rootFrame = hydrationStack[0];
  if (rootFrame) {
    skipIgnorableNodes(rootFrame);
    clearRemainingHydrationNodes(rootFrame);
  }
}

export { BLOCK_END, BLOCK_START };
