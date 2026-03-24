import {
  ATTR_BINDING,
  COMPONENT_REACTIVE_PROPS,
  DYNAMIC,
  LIST,
  NODE_FACTORY,
  TEMPLATE_FACTORY,
  TEXT_BINDING,
  type AttrBinding,
  type Dynamic,
  type DynamicKind,
  type ForProps,
  type KeyedList,
  type NodeFactory,
  type ShowProps,
  type TemplateFactory,
  type TextBinding,
  isAttrBinding,
  isDynamic,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
} from "../shared";

export interface Cell<T> {
  value: T;
  subscribers: Set<never>;
}

export function cell<T>(value: T): Cell<T> {
  return {
    value,
    subscribers: new Set<never>(),
  };
}

export function store<T extends object>(value: T): T {
  return value;
}

export function get<T>(slot: Cell<T>): T {
  return slot.value;
}

export function set<T>(slot: Cell<T>, next: T): T {
  slot.value = next;
  return next;
}

export function effect(fn: () => void): () => void {
  fn();
  return () => undefined;
}

export function node<T>(read: () => T): NodeFactory<T> {
  return {
    [NODE_FACTORY]: true,
    read,
  };
}

export function text<T>(cellValue: Cell<T>): TextBinding<T> {
  return {
    [TEXT_BINDING]: true,
    cell: cellValue,
  };
}

export function attr<T>(cellValue: Cell<T>): AttrBinding<T> {
  return {
    [ATTR_BINDING]: true,
    cell: cellValue,
  };
}

export function tpl<T>(html: string, read: () => T): TemplateFactory<T> {
  return {
    [TEMPLATE_FACTORY]: true,
    html,
    read,
  };
}

function createDynamic<T>(kind: DynamicKind, read: () => T): Dynamic<T> {
  return {
    [DYNAMIC]: true,
    kind,
    read,
  };
}

export function dynText<T>(read: () => T): Dynamic<T> {
  return createDynamic("text", read);
}

export function dynAttr<T>(read: () => T): Dynamic<T> {
  return createDynamic("attr", read);
}

export function dynBlock<T>(read: () => T): Dynamic<T> {
  return createDynamic("block", read);
}

export function dyn<T>(read: () => T): Dynamic<T> {
  return dynBlock(read);
}

export function list<T>(
  read: () => T[],
  key: (item: T, index: number) => string | number,
  render: (item: T, index: number) => unknown,
): KeyedList<T> {
  return {
    [LIST]: true,
    read,
    key,
    render,
  };
}

function unwrapControlFlowValue<T>(value: T): T {
  if (isDynamic(value)) {
    return value.read() as T;
  }

  if (isTextBinding(value)) {
    return get(value.cell as Cell<any>) as T;
  }

  if (isAttrBinding(value)) {
    return get(value.cell as Cell<any>) as T;
  }

  if (isNodeFactory(value)) {
    return value.read() as T;
  }

  if (isTemplateFactory(value)) {
    return value.read() as T;
  }

  return value;
}

export function For<T>(rawProps: Record<string, unknown>): any {
  const props = rawProps as ForProps<T>;
  const items = (unwrapControlFlowValue(props.each) ?? []) as T[];
  const render = props.children?.[0];

  if (items.length === 0) {
    return unwrapControlFlowValue(props.fallback) ?? null;
  }

  if (typeof render !== "function") {
    return items;
  }

  const renderItem = render as (item: T, index: number) => unknown;

  if (!props.key) {
    return items.map((item, index) => renderItem(item, index));
  }

  return list(
    () => items,
    props.key,
    renderItem,
  );
}

export function Show(rawProps: Record<string, unknown>): any {
  const props = rawProps as ShowProps;
  return unwrapControlFlowValue(props.when) ? props.children ?? null : unwrapControlFlowValue(props.fallback) ?? null;
}

export function component<T extends (...args: any[]) => any>(fn: T): T {
  Object.defineProperty(fn, COMPONENT_REACTIVE_PROPS, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return fn;
}

export {
  isAttrBinding,
  isDynamic,
  isKeyedList,
  isNodeFactory,
  isTemplateFactory,
  isTextBinding,
} from "../shared";
