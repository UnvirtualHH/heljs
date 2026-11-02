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
      "import { cell as __cell, get as __get, component as __component, h as __h, node as __node, text as __text, tpl as __tpl } from "hel/runtime";
      export function Banner() {const __cell_count_0 = __cell(
          0);
        return __h("section", null, __tpl("<h1>Static</h1>", () => __h("h1", null, "Static")), __node(() => __h("p", null, __text(__cell_count_0))));
      }__component(Banner);"
    `);
  });

  it("uses template factories for fully static jsx subtrees", () => {
    const output = transform(`
      export function Banner() {
        return <section><div class="hero"><strong>Hel</strong><span>Static</span></div></section>;
      }
    `);

    expect(output).toContain('__tpl("<div class=\\"hero\\"><strong>Hel</strong><span>Static</span></div>"');
    expect(output).not.toContain("__node(() => __h(\"div\"");
  });

  it("uses direct attr bindings for simple reactive prop reads", () => {
    const output = transform(`
      export function Field() {
        let title = "hel";
        return <input value={title} />;
      }
    `);

    expect(output).toContain("__attr(__cell_title_0)");
    expect(output).not.toContain("__dynAttr(() => __get(__cell_title_0))");
  });

  it("normalizes className when emitting static templates", () => {
    const output = transform(`
      export function Banner() {
        return <section><div className="hero">Hel</div></section>;
      }
    `);

    expect(output).toContain('__tpl("<div class=\\"hero\\">Hel</div>"');
    expect(output).not.toContain('className=\\"hero\\"');
  });

  it("uses template factories for fully static fragments", () => {
    const output = transform(`
      export function Banner() {
        return <section><><span>One</span><span>Two</span></></section>;
      }
    `);

    expect(output).toContain('__tpl("<span>One</span><span>Two</span>"');
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

  it("emits specialized branch slots for reactive conditional block expressions", () => {
    const output = transform(`
      export function Toggle(props) {
        return <section>{props.visible ? <ul><li>Open</li></ul> : <p>Closed</p>}</section>;
      }
    `);

    expect(output).toContain("__branch(() => props.visible");
    expect(output).not.toContain("__dynBlock(() => props.visible ?");
  });

  it("gives reactive ternary arms their own slots", () => {
    const output = transform(`
      export function Toggle() {
        let a = false;
        let b = false;
        let items = [];
        let count = 0;
        return (
          <section>
            {a ? <i>A</i> : b ? <i>B</i> : <i>C</i>}
            {a ? items.map((item) => <li>{item}</li>) : null}
            {a ? <i>A</i> : count}
          </section>
        );
      }
    `);

    const compact = output.replace(/\s+/g, " ");
    expect(compact).toContain("() => __branch(() => __get(__cell_b_1)");
    expect(compact).toContain("() => __dynBlock(() => __get(__cell_items_2).map(");
    expect(compact).toContain("() => __text(__cell_count_3)");
  });

  it("does not wrap JSX ternary arms in extra slots", () => {
    const output = transform(`
      export function Toggle() {
        let a = false;
        let count = 0;
        return <section>{a ? <p>{count}</p> : null}</section>;
      }
    `);

    expect(output).toContain('() => __h("p", null, __text(__cell_count_1))');
    expect(output).toContain("() => null");
  });

  it("passes imported list() calls straight to the keyed list slot", () => {
    const output = transform(`
      import { list as keyed } from "hel/runtime";
      export function Rows() {
        let items = [];
        return <ul>{keyed(() => items, (item) => item.id, (item) => <li>{item.id}</li>)}</ul>;
      }
    `);

    expect(output).not.toContain("__dynBlock");
  });

  it("keeps a local function named list as a normal block dynamic", () => {
    const output = transform(`
      function list(items) { return items.map((item) => <li>{item}</li>); }
      export function Rows() {
        let items = [];
        return <ul>{list(items)}</ul>;
      }
    `);

    expect(output).toContain("__dyn");
  });

  it("renders JSX props on components lazily but keeps them eager on elements", () => {
    const output = transform(`
      export function Panel() {
        return <Show when={true} fallback={<u>hidden</u>}><b>shown</b></Show>;
      }
      export function Plain() {
        return <div title={<u>hidden</u>} />;
      }
    `);

    expect(output).toContain('fallback: __node(() => __h("u", null, "hidden"))');
    expect(output).toContain('title: __h("u", null, "hidden")');
  });

  it("rewrites destructuring assignments to reactive lets", () => {
    const output = transform(`
      export function Swap() {
        let a = 1;
        let b = 2;
        return <button onClick={() => { [a, b] = [b, a]; }}>x</button>;
      }
    `);

    expect(output).toContain("__set(__cell_a_0,");
    expect(output).toContain("__set(__cell_b_1,");
  });

  it("leaves destructuring assignments to ordinary variables alone", () => {
    const output = transform(`
      export function Swap() {
        let a = 1;
        return <button onClick={() => { let x; let y; [x, y] = [a, a]; }}>x</button>;
      }
    `);

    expect(output).toContain("[x, y] = [__get(__cell_a_0), __get(__cell_a_0)]");
  });

  it("rewrites for-of and for-in targets that are reactive lets", () => {
    const output = transform(`
      export function Loop() {
        let last = 0;
        let key = "";
        return (
          <button onClick={() => {
            for (last of [1, 2]) console.log(last);
            for (key in {}) {}
          }}>x</button>
        );
      }
    `);

    expect(output).toContain("__set(__cell_last_0,");
    expect(output).toContain("__set(__cell_key_1,");
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

  it("keeps body-level prop destructuring reactive", () => {
    const output = transform(`
      export function TodoCard(props) {
        const { todo, selectedId } = props;
        return <article data-selected={selectedId === todo.id}>{selectedId}</article>;
      }
    `);

    expect(output).toContain("const __prop_0 = () => props.todo;");
    expect(output).toContain("const __prop_1 = () => props.selectedId;");
    expect(output).toContain("__dynAttr(() => __prop_1() === __prop_0().id)");
    expect(output).toContain("__dynText(() => __prop_1())");
  });

  it("keeps parameter prop destructuring reactive", () => {
    const output = transform(`
      export function TodoCard({ todo, selectedId }) {
        return <article data-selected={selectedId === todo.id}>{selectedId}</article>;
      }
    `);

    expect(output).toContain("function TodoCard(_props)");
    expect(output).toContain("const __prop_0 = () => _props.todo;");
    expect(output).toContain("const __prop_1 = () => _props.selectedId;");
    expect(output).toContain("__dynAttr(() => __prop_1() === __prop_0().id)");
    expect(output).toContain("__dynText(() => __prop_1())");
  });

  it("supports nested prop destructuring and aliases reactively", () => {
    const output = transform(`
      export function TodoCard(props) {
        const { todo: { title }, meta: info } = props;
        return <article>{title} / {info.level}</article>;
      }
    `);

    expect(output).toContain("const __prop_0 = () => props.todo.title;");
    expect(output).toContain("const __prop_1 = () => props.meta;");
    expect(output).toContain("__dynText(() => __prop_0())");
    expect(output).toContain("__dynText(() => __prop_1().level)");
  });

  it("supports nested parameter destructuring with defaults reactively", () => {
    const output = transform(`
      export function TodoCard({ todo: { title = "fallback" } }) {
        return <article>{title}</article>;
      }
    `);

    expect(output).toContain('function TodoCard(_props)');
    expect(output).toContain('return __value === undefined ? "fallback" : __value;');
    expect(output).toContain("__dynText(() => __prop_0())");
  });

  it("treats helper functions that return destructured children as block dynamics", () => {
    const output = transform(`
      export function Panel(props) {
        const { children } = props;
        function content() {
          return children;
        }
        return <section>{content()}</section>;
      }
    `);

    expect(output).toContain("const __prop_0 = () => props.children;");
    expect(output).toContain("__dynBlock(() => content())");
    expect(output).not.toContain("__dynText(() => content())");
  });

  it("fails loudly for component default parameters", () => {
    const error = transformError(`
      export function TodoCard(props = { title: "Hel" }) {
        return <article>{props.title}</article>;
      }
    `);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("component parameters other than a plain identifier are not supported yet");
    expect(error?.message).toContain("TodoCard");
  });

  it("fails loudly for component rest parameters", () => {
    const error = transformError(`
      export function TodoCard(...props) {
        return <article>{props.length}</article>;
      }
    `);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("component parameters other than a plain identifier are not supported yet");
    expect(error?.message).toContain("TodoCard");
  });

  it("treats store reads in jsx as reactive dependencies", () => {
    const output = transform(`
      import { store } from "hel/runtime";
      export function Counter() {
        const state = store({ count: 0 });
        return <p>{state.count}</p>;
      }
    `);

    expect(output).toContain("__dynText(() => state.count)");
  });

  it("tracks helper functions that read from store bindings", () => {
    const output = transform(`
      import { store } from "hel/runtime";
      export function Counter() {
        const state = store({ count: 0 });
        function label() {
          return state.count % 2 === 0 ? "even" : "odd";
        }
        return <p>{label()}</p>;
      }
    `);

    expect(output).toContain("__dynText(() => label())");
  });

  it("treats component prop reads as reactive dependencies in jsx", () => {
    const output = transform(`
      export function TodoCard(props) {
        return <article data-selected={props.selectedId === props.todo.id}>{props.selectedId}</article>;
      }
    `);

    expect(output).toContain("__dynAttr(() => props.selectedId === props.todo.id)");
    expect(output).toContain("__dynText(() => props.selectedId)");
  });

  it("rewrites reactive const derivations into internal derived helpers", () => {
    const output = transform(`
      export function Counter() {
        let count = 0;
        const label = count % 2 === 0 ? "even" : "odd";
        return <p>{label}</p>;
      }
    `);

    expect(output).toContain("const __derived_label_0 = () =>");
    expect(output).toContain("__get(__cell_count_0) % 2 === 0 ? \"even\" : \"odd\"");
    expect(output).toContain("__dynText(() => __derived_label_0())");
  });
});
