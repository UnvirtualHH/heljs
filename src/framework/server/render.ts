import {
  get,
  isAttrBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
  type Cell,
} from "./core";
import { BLOCK_END, BLOCK_START } from "../shared";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export type ServerElement = {
  type: "element";
  tag: string;
  props: Record<string, unknown> | null;
  children: Renderable[];
};

export type ServerFragment = {
  type: "fragment";
  children: Renderable[];
};

export type Renderable =
  | string
  | number
  | boolean
  | null
  | undefined
  | import("../shared").Dynamic
  | import("../shared").KeyedList<any>
  | import("../shared").TextBinding<any>
  | import("../shared").AttrBinding<any>
  | import("../shared").TemplateFactory<any>
  | import("../shared").NodeFactory
  | Renderable[]
  | ServerElement
  | ServerFragment;

function isServerElement(value: unknown): value is ServerElement {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element";
}

function isServerFragment(value: unknown): value is ServerFragment {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "fragment";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function normalizeTextValue(value: unknown): string {
  if (value == null || value === false || value === true) {
    return "";
  }

  return String(value);
}

function toStyleString(value: unknown): string {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const parts: string[] = [];

  for (const [key, entry] of entries) {
    if (entry == null || entry === false) {
      continue;
    }

    const cssKey = key.replace(/[A-Z]/g, (segment) => `-${segment.toLowerCase()}`);
    parts.push(`${cssKey}:${String(entry)}`);
  }

  return parts.join(";");
}

function resolveAttrValue(value: unknown): unknown {
  if (isAttrBinding(value)) {
    return get(value.cell as Cell<any>);
  }

  if (!isDynamic(value)) {
    return value;
  }

  if (value.kind === "block") {
    return null;
  }

  return resolveAttrValue(value.read());
}

function serializeProps(props: Record<string, unknown> | null): string {
  if (!props) {
    return "";
  }

  const attributes: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(props)) {
    if (rawKey === "children" || rawKey.startsWith("on")) {
      continue;
    }

    const normalizedKey = rawKey === "className" ? "class" : rawKey;
    const resolved = resolveAttrValue(rawValue);

    if (resolved == null || resolved === false) {
      continue;
    }

    if (resolved === true) {
      attributes.push(` ${normalizedKey}=""`);
      continue;
    }

    const value = normalizedKey === "style" ? toStyleString(resolved) : String(resolved);
    attributes.push(` ${normalizedKey}="${escapeAttribute(value)}"`);
  }

  return attributes.join("");
}

function serializeValue(value: unknown): string {
  if (isNodeFactory(value)) {
    return serializeValue(value.read());
  }

  if (isTextBinding(value)) {
    return escapeHtml(normalizeTextValue(get(value.cell as Cell<any>)));
  }

  if (isAttrBinding(value)) {
    return "";
  }

  if (isTemplateFactory(value)) {
    return serializeValue(value.read());
  }

  if (isDynamic(value)) {
    if (value.kind === "attr") {
      return "";
    }

    if (value.kind === "block") {
      return `<!--${BLOCK_START}-->${serializeValue(value.read())}<!--${BLOCK_END}-->`;
    }

    return escapeHtml(normalizeTextValue(value.read()));
  }

  if (isKeyedList(value)) {
    return `<!--${BLOCK_START}-->${value.read().map((item, index) => serializeValue(value.render(item, index))).join("")}<!--${BLOCK_END}-->`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).join("");
  }

  if (isServerFragment(value)) {
    return value.children.map((entry) => serializeValue(entry)).join("");
  }

  if (isServerElement(value)) {
    const open = `<${value.tag}${serializeProps(value.props)}>`;
    if (VOID_TAGS.has(value.tag)) {
      return open;
    }

    const children = value.children.map((entry) => serializeValue(entry)).join("");
    return `${open}${children}</${value.tag}>`;
  }

  if (value == null || value === false || value === true) {
    return "";
  }

  return escapeHtml(String(value));
}

export function h(
  tag: string | ((props: any) => unknown),
  props: Record<string, unknown> | null,
  ...children: any[]
): Renderable {
  if (typeof tag === "function") {
    return tag({ ...(props ?? {}), children }) as Renderable;
  }

  return {
    type: "element",
    tag,
    props,
    children,
  };
}

export function frag(...children: Renderable[]): Renderable {
  return {
    type: "fragment",
    children,
  };
}

export function renderToString(factory: () => unknown): string {
  return serializeValue(factory());
}
