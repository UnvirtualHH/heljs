import { runtimeStats } from "./core";

const IS_DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
const templateCache = new Map<string, HTMLTemplateElement>();

export function appendNode(parent: Node, node: Node): void {
  parent.appendChild(node);
  if (IS_DEV && parent.isConnected) {
    runtimeStats.domInsertions += 1;
  }
}

export function insertNodeBefore(parent: Node, node: Node, reference: Node | null): void {
  parent.insertBefore(node, reference);
  if (IS_DEV && parent.isConnected) {
    runtimeStats.domInsertions += 1;
  }
}

export function insertNodesBefore(parent: Node, nodes: Node[], reference: Node | null): void {
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
  if (IS_DEV && parent.isConnected) {
    runtimeStats.domInsertions += nodes.length;
  }
}

export function removeNode(parent: Node, node: Node): void {
  parent.removeChild(node);
  if (IS_DEV && parent.isConnected) {
    runtimeStats.domRemovals += 1;
  }
}

export function replaceNode(parent: Node, next: Node, current: Node): void {
  parent.replaceChild(next, current);
  if (IS_DEV && parent.isConnected) {
    runtimeStats.domReplacements += 1;
  }
}

export function replaceNodesBetween(
  parent: Node,
  start: Node,
  end: Node,
  nextNodes: Node[],
  currentCount: number,
): void {
  // Emptying the parent is far cheaper than removing node by node or through a Range.
  if (start.previousSibling === null && end.nextSibling === null) {
    parent.textContent = "";
    parent.appendChild(start);
    parent.appendChild(end);
  } else {
    let current = start.nextSibling;
    while (current !== end) {
      const next: ChildNode | null = current!.nextSibling;
      parent.removeChild(current!);
      current = next;
    }
  }

  if (nextNodes.length === 1) {
    parent.insertBefore(nextNodes[0]!, end);
  } else if (nextNodes.length > 1) {
    const fragment = document.createDocumentFragment();
    for (const node of nextNodes) {
      fragment.appendChild(node);
    }
    parent.insertBefore(fragment, end);
  }

  if (IS_DEV && parent.isConnected) {
    runtimeStats.domRemovals += currentCount;
    runtimeStats.domInsertions += nextNodes.length;
  }
}

export function cloneTemplate(html: string): Node {
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
