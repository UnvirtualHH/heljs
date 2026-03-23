import { describe, expect, it } from "vitest";
import { helMagicPlugin } from "./plugin";

function transform(code: string): string {
  const plugin = helMagicPlugin();
  const transformHook = plugin.transform;
  const handler =
    typeof transformHook === "function"
      ? transformHook
      : transformHook && typeof transformHook === "object" && "handler" in transformHook
        ? transformHook.handler
        : null;

  const result = handler
    ? (handler as (this: unknown, code: string, id: string) => unknown).call({}, code, "Component.tsx")
    : null;

  if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string") {
    throw new Error("Expected transformed output");
  }

  return result.code;
}

function transformError(code: string): Error | null {
  try {
    transform(code);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe("compiler plugin", () => {
  it("tracks helper functions that read reactive let bindings", () => {
    const output = transform(`
      export function Counter() {
        let count = 0;
        function label() {
          return count % 2 === 0 ? "even" : "odd";
        }
        return <p>{label()}</p>;
      }
    `);

    expect(output).toContain("__cell(");
    expect(output).toContain("__dynText(() => label())");
  });

  it("keeps static JSX text out of dynamic slots", () => {
    const output = transform(`
      export function Banner() {
        let count = 0;
        return <section><h1>Static</h1><p>{count}</p></section>;
      }
    `);

    expect(output).toMatchInlineSnapshot(`
      "import { cell as __cell, get as __get, h as __h, node as __node, dynText as __dynText } from "@hel/runtime";
      export function Banner() {const __cell_count_0 = __cell(
          0);
        return __h("section", null, __node(() => __h("h1", null, "Static")), __node(() => __h("p", null, __dynText(() => __get(__cell_count_0)))));
      }"
    `);
  });

  it("treats mapped jsx arrays as block dynamics instead of text dynamics", () => {
    const output = transform(`
      export function List() {
        let count = 2;
        const rows = () => Array.from({ length: count }, (_, index) => <li>{index}</li>);
        return <ul>{rows().map((entry) => entry)}</ul>;
      }
    `);

    expect(output).toContain("__dynBlock(() => rows().map((entry) => entry))");
    expect(output).not.toContain("__dynText(() => rows().map((entry) => entry))");
  });

  it("fails loudly for reactive let destructuring in component scope", () => {
    const error = transformError(`
      export function Counter() {
        let { count } = { count: 0 };
        return <p>{count}</p>;
      }
    `);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("reactive let destructuring is not supported yet");
    expect(error?.message).toContain("Component.tsx");
    expect(error?.message).toContain("Counter");
  });
});
