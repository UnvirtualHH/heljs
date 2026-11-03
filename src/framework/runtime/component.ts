import { COMPONENT_RESULT, tagOf } from "../shared";
import type { Scope } from "./core";

export type ComponentResult = {
  $t: typeof COMPONENT_RESULT;
  value: unknown;
  scope: Scope;
};

export function componentResult(value: unknown, scope: Scope): ComponentResult {
  return {
    $t: COMPONENT_RESULT,
    value,
    scope,
  };
}

export function isComponentResult(value: unknown): value is ComponentResult {
  return tagOf(value) === COMPONENT_RESULT;
}
