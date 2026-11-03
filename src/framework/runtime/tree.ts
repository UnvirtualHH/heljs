import type { TreeElement, TreeNode } from "../shared";
import { appendChild, applyProp, fillTextPlaceholder } from "./slots";

const ATTRIBUTE_NAMES: Record<string, string> = { className: "class", htmlFor: "for" };
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// The HTML parser drops whitespace in these, so a text placeholder would not survive.
const NO_TEXT_PARENTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup", "select"]);

const ATTRIBUTE = 0;
const APPEND = 1;
const COMMENT = 2;
const TEXT = 3;

type TreeStep = {
  kind: number;
  node: number;
  key: string;
  before: number;
  value: number;
};

export type TreePlan = {
  root: Node;
  size: number;
  from: number[];
  first: boolean[];
  steps: TreeStep[];
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function hasHoles(node: TreeNode): boolean {
  if (typeof node === "number") {
    return true;
  }

  if (typeof node === "string") {
    return false;
  }

  const [, attrs, ...children] = node;
  return Object.values(attrs ?? {}).some((value) => typeof value === "number") || children.some(hasHoles);
}

// How a dynamic child gets its place. Most hold text, so a text node in the template
// can be reused. It would merge with text next to it, so that needs a comment
// instead, and a slot at the very end of its parent can simply be appended.
function holeKind(tag: string, children: TreeNode[], position: number): number {
  const previous = children[position - 1];
  const next = children[position + 1];
  const nextToText = typeof previous === "string" || typeof previous === "number" || typeof next === "string" || typeof next === "number";

  if (!nextToText && !NO_TEXT_PARENTS.has(tag)) {
    return TEXT;
  }

  for (let index = position + 1; index < children.length; index += 1) {
    if (typeof children[index] !== "number") {
      return COMMENT;
    }
  }

  return APPEND;
}

// The HTML parser can change a structure, such as adding a <tbody>. A plan is only
// right if the parsed template still has the shape it was written for.
function matchesParsedTemplate(node: Node, element: TreeElement): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE || (node as Element).tagName.toLowerCase() !== element[0].toLowerCase()) {
    return false;
  }

  const children = element.slice(2) as TreeNode[];
  const parsed = node.childNodes;
  let position = 0;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const kind = typeof child === "number" ? holeKind(element[0], children, index) : -1;

    if (kind === APPEND) {
      continue;
    }

    const current = parsed[position];
    position += 1;

    if (!current) {
      return false;
    }

    if (kind === COMMENT) {
      if (current.nodeType !== Node.COMMENT_NODE) {
        return false;
      }
    } else if (kind === TEXT || typeof child === "string") {
      if (current.nodeType !== Node.TEXT_NODE || (current as Text).data !== (kind === TEXT ? " " : child)) {
        return false;
      }
    } else if (!matchesParsedTemplate(current, child as TreeElement)) {
      return false;
    }
  }

  return position === parsed.length;
}

export function buildTreePlan(element: TreeElement): TreePlan | false {
  const from: number[] = [];
  const first: boolean[] = [];
  const steps: TreeStep[] = [];
  let size = 1;

  const step = (kind: number, node: number, key: string, before: number, value: number): void => {
    steps.push({ kind, node, key, before, value });
  };

  const visit = (current: TreeElement, index: number): string => {
    const [tag, attrs, ...children] = current;
    let html = `<${tag}`;
    let lateValue = -1;

    for (const key in attrs) {
      const value = attrs[key]!;

      if (typeof value !== "number") {
        const text = value === true ? "" : escapeHtml(value).replaceAll('"', "&quot;");
        html += ` ${ATTRIBUTE_NAMES[key] ?? key}="${text}"`;
      } else if (key === "value" && tag === "select") {
        lateValue = value;
      } else {
        step(ATTRIBUTE, index, key, -1, value);
      }
    }

    html += ">";

    if (VOID_TAGS.has(tag)) {
      return html;
    }

    // Only nodes up to the last one that is needed have to be walked to.
    let lastNeeded = -1;
    children.forEach((child, position) => {
      if (hasHoles(child) && (typeof child !== "number" || holeKind(tag, children, position) !== APPEND)) {
        lastNeeded = position;
      }
    });

    let previous = -1;

    children.forEach((child, position) => {
      const kind = typeof child === "number" ? holeKind(tag, children, position) : -1;

      if (kind === APPEND) {
        step(APPEND, index, "", -1, child as number);
        return;
      }

      let nodeIndex = -1;
      if (position <= lastNeeded) {
        nodeIndex = size;
        size += 1;
        from.push(previous < 0 ? index : previous);
        first.push(previous < 0);
        previous = nodeIndex;
      }

      if (kind === COMMENT) {
        html += "<!---->";
        step(COMMENT, index, "", nodeIndex, child as number);
      } else if (kind === TEXT) {
        html += " ";
        step(TEXT, index, "", nodeIndex, child as number);
      } else if (typeof child === "string") {
        html += escapeHtml(child);
      } else {
        html += visit(child as TreeElement, nodeIndex);
      }
    });

    if (lateValue >= 0) {
      step(ATTRIBUTE, index, "value", -1, lateValue);
    }

    return `${html}</${tag}>`;
  };

  const template = document.createElement("template");
  template.innerHTML = visit(element, 0);
  const root = template.content.firstChild;

  if (!root || template.content.childNodes.length !== 1 || !matchesParsedTemplate(root, element)) {
    return false;
  }

  return { root, size, from, first, steps };
}

export function instantiateTree(plan: TreePlan, values: unknown[]): Node {
  const { size, from, first, steps } = plan;
  const nodes = new Array<Node>(size);
  const root = plan.root.cloneNode(true);
  nodes[0] = root;

  for (let index = 1; index < size; index += 1) {
    const source = nodes[from[index - 1]!]!;
    nodes[index] = (first[index - 1] ? source.firstChild : source.nextSibling)!;
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const value = values[step.value];

    switch (step.kind) {
      case TEXT:
        fillTextPlaceholder(nodes[step.node]!, nodes[step.before] as Text, value);
        break;
      case ATTRIBUTE:
        applyProp(nodes[step.node] as HTMLElement, step.key, value);
        break;
      case APPEND:
        appendChild(nodes[step.node]!, value);
        break;
      default: {
        const holder = document.createDocumentFragment();
        appendChild(holder, value);
        nodes[step.node]!.replaceChild(holder, nodes[step.before]!);
      }
    }
  }

  return root;
}
