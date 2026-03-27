import type { Scope } from "./core";

const COMPONENT_RESULT = Symbol("hel.component-result");

export type ComponentResult = {
  [COMPONENT_RESULT]: true;
  value: unknown;
  scope: Scope;
};

export function componentResult(value: unknown, scope: Scope): ComponentResult {
  return {
    [COMPONENT_RESULT]: true,
    value,
    scope,
  };
}

export function isComponentResult(value: unknown): value is ComponentResult {
  return typeof value === "object" && value !== null && COMPONENT_RESULT in value;
}
