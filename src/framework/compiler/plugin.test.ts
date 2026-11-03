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

describe("JSX text and static templates", () => {
  const firstTemplate = (output: string) => /__tpl\("([^"]*)"/.exec(output.replace(/\s+/g, " "))?.[1];

  it("keeps whitespace on one line and drops whitespace with a line break", () => {
    const output = transform(`function Comp(props) {
      return <p>
        Hello {props.a} {props.b}
        and goodbye
      </p>;
    }`).replace(/\s+/g, " ");

    expect(output).toContain('"Hello "');
    expect(output).toContain('" "');
    expect(output).toContain('"and goodbye"');
  });

  it("writes void tags once in a template", () => {
    expect(firstTemplate(transform(`function Comp(props) { return <section><Other /><p>a<br />b</p></section>; }`))).toBe(undefined);
    expect(firstTemplate(transform(`function Comp(props) { return <>{props.a}<p>a<br />b</p></>; }`))).toBe("<p>a<br>b</p>");
  });

  it("does not build a template from an SVG child on its own", () => {
    const output = transform(`function Comp(props) { return <svg>{props.a}<circle r="1" /></svg>; }`);

    expect(output).not.toContain("<circle");
  });

  it("does build a template from a whole static SVG", () => {
    expect(firstTemplate(transform(`function Comp(props) { return <>{props.a}<svg><circle r="1" /></svg></>; }`))).toContain("<svg><circle");
  });
});

describe("async functions", () => {
  it("rejects an async component", () => {
    expect(transformError(`async function Comp() { return <div />; }`)?.message).toMatch(/async component.*useResource/);
  });

  it("rejects an async component that awaits", () => {
    expect(transformError(`async function Comp() { const data = await load(); return <div>{data}</div>; }`)?.message).toMatch(/useResource/);
  });

  it("rejects every other way of writing an async component", () => {
    expect(transformError(`const Comp = async () => <div />;`)?.message).toMatch(/useResource/);
    expect(transformError(`export default async function () { return <div />; }`)?.message).toMatch(/useResource/);
    expect(transformError(`const Comp = wrap(async () => <div />);`)?.message).toMatch(/useResource/);
  });

  it("rejects an async use* function", () => {
    expect(transformError(`async function useThing() { let a = 1; return { a }; }`)?.message).toMatch(/async use\* function.*useResource/);
    expect(transformError(`const useThing = async () => ({});`)?.message).toMatch(/useResource/);
  });

  it("allows async functions inside a component", () => {
    expect(transformError(`function Comp() { let n = 0; async function save() { n = await load(); } return <button onClick={save}>{n}</button>; }`)).toBeNull();
    expect(transformError(`async function load() { return <div />; }`)).toBeNull();
  });
});

describe("a row's key", () => {
  it("needs no slot when the row reads the same property", () => {
    const output = transform(`
      import { For } from "hel/runtime";
      function List(props) {
        return <ul><For each={props.rows} key={(row) => row.id}>{(row) => <li onClick={() => pick(row.id)}>{row.id}: {row.label}</li>}</For></ul>;
      }
    `).replace(/\s+/g, " ");

    expect(output).toMatch(/__row\(\(_item, _index, _key\)/);
    expect(output).toContain("pick(_key)");
    expect(output).toContain("_item().label");
    expect(output).not.toContain("_item().id");
  });

  it("is not used for anything else, or without a simple key", () => {
    const other = transform(`
      import { For } from "hel/runtime";
      function List(props) {
        return <ul><For each={props.rows} key={(row) => row.id + 1}>{(row) => <li>{row.id}</li>}</For></ul>;
      }
    `);

    expect(other).toContain("_item().id");
  });
});

describe("hooks called on an object", () => {
  it("are not re-run on a change", () => {
    const output = transform(`function Comp(props) { const thing = api.useThing(props.id); return <p>{thing.value}</p>; }`);

    expect(output).toContain("api.useThing");
    expect(output).not.toContain("__memo");
  });

  it("does not apply to other member calls", () => {
    expect(transform(`function Comp(props) { const url = api.createUrl(props.id); return <p>{url}</p>; }`)).toContain("__memo");
  });
});

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

    const compact = output.replace(/\s+/g, " ");
    expect(compact).toContain('desc: ["section", null, ["h1", null, "Static"], ["p", null, 0]]');
    expect(compact).toContain("__tree(__tree_0, [__text(__cell_count_0)])");
  });

  it("uses template factories for fully static jsx subtrees", () => {
    const output = transform(`
      export function Banner() {
        return <><div class="hero"><strong>Hel</strong><span>Static</span></div></>;
      }
    `);

    expect(output).toContain('__tpl("<div class=\\"hero\\"><strong>Hel</strong><span>Static</span></div>"');
    expect(output).not.toContain("__node(() => __h(\"div\"");
  });

  it("describes a whole element tree once, in the module", () => {
    const output = transform(`
      export function Row(props) {
        return <tr class={props.kind}><td class="a">{props.id}</td><td><a onClick={props.pick}>{props.label}</a></td></tr>;
      }
      export function Other(props) {
        return <tr class={props.kind}><td class="a">{props.id}</td><td><a onClick={props.pick}>{props.label}</a></td></tr>;
      }
    `).replace(/\s+/g, " ");

    expect(output).toContain("const __tree_0 = {");
    expect(output).not.toContain("__tree_1");
    expect(output).toContain('"class": 0');
    expect(output.indexOf("__tree_0 = {")).toBeLessThan(output.indexOf("function Row"));
  });

  it("leaves what a template cannot hold to element-by-element rendering", () => {
    expect(transform(`function A(p) { return <div {...p}><b>x</b></div>; }`)).not.toContain("__tree(");
    expect(transform(`function A(p) { return <svg>{p.a}<circle r="1" /></svg>; }`)).toContain("__tree(");
    expect(transform(`function A(p) { return <circle r={p.r}><title>x</title></circle>; }`)).not.toContain("__tree(");
    expect(transform(`function A(p) { return <div><textarea>{p.a}</textarea></div>; }`)).not.toContain("__tree(");
    expect(transform(`function A(p) { return <p>{p.a}</p>; }`)).not.toContain("__tree(");
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
        return <><div className="hero">Hel</div></>;
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

  it("treats const initializers by the same rule as JSX expressions", () => {
    const output = transform(`
      import { store, untrack } from "hel/runtime";
      import { cart } from "./cart";
      export function Panel(props) {
        let count = 0;
        const factor = 2;
        const bare = count;
        const expr = count * factor;
        const viaCall = compute();
        const alias = props.title;
        const moduleRead = cart.total;
        const element = <i>{count}</i>;
        const state = store({ count });
        const first = untrack(() => count);
        const instance = new Thing(count);
        const hook = useThing(count);
        const made = createThing(count);
        const callback = () => count;
        return null;
      }
    `).replace(/\s+/g, " ");

    expect(output).toContain("const factor = 2;");
    expect(output).toContain("const __derived_bare_0 = __memo(() => __get(__cell_count_0))");
    expect(output).toContain("const __derived_expr_1 = __memo(() => __get(__cell_count_0) * factor)");
    expect(output).toContain("const __derived_viaCall_2 = __memo(() => compute())");
    expect(output).toContain("const __derived_alias_3 = () => props.title");
    expect(output).toContain("const __derived_moduleRead_4 = () => cart.total");
    expect(output).toContain('const __derived_element_5 = __memo(() => __h("i", null, __text(__cell_count_0)), true)');
    expect(output).toContain("const state = store(");
    expect(output).toContain("const first = untrack(");
    expect(output).toContain("const instance = new Thing(");
    expect(output).toContain("const hook = useThing(");
    expect(output).toContain("const made = createThing(");
    expect(output).toContain("const callback = () =>");
  });

  it("makes unknown member reads and calls dynamic, plain identifiers static", () => {
    const output = transform(`
      export function Row({ label }) {
        const plain = 1;
        return <li title={config.title} data-id={plain} ref={setRef}>{cart.total}{format(plain)}{plain}{label}</li>;
      }
    `).replace(/\s+/g, " ");

    expect(output).toContain("title: __dynAttr(() => config.title)");
    expect(output).toContain('"data-id": plain');
    expect(output).toContain("ref: setRef");
    expect(output).toContain("__dynText(() => cart.total)");
    expect(output).toContain("__dynText(() => format(plain))");
    expect(output).toContain("__dynText(() => __prop_0())");
    expect(output).toMatch(/format\(plain\)\), plain,/);
  });

  it("applies the same rule to JSX outside of components", () => {
    const output = transform(`
      export const row = (item) => <li>{item.title}</li>;
    `);

    expect(output).toContain("__dynText(() => item.title)");
  });

  it("compiles use* functions like components, without marking them as components", () => {
    const output = transform(`
      export function useCounter() {
        let count = 0;
        const doubled = count * 2;
        function increment() { count++; }
        return { count, doubled, increment, label: "x" };
      }
    `).replace(/\s+/g, " ");

    expect(output).toContain("__cell(");
    expect(output).toMatch(/get count\(\) ?\{ ?return __get\(__cell_count_0\);? ?\}/);
    expect(output).toMatch(/get doubled\(\) ?\{ ?return __derived_doubled_0\(\);? ?\}/);
    expect(output).toContain("increment,");
    expect(output).toContain('label: "x"');
    expect(output).not.toContain("__component");
  });

  it("fails loudly when a use* function would freeze reactive values", () => {
    const direct = transformError(`
      export function useCounter() {
        let count = 0;
        return count;
      }
    `);
    const array = transformError(`
      export function useCounter() {
        let count = 0;
        return [count, () => count++];
      }
    `);

    expect(direct?.message).toContain("useCounter");
    expect(direct?.message).toContain("would freeze");
    expect(array?.message).toContain("in an array would freeze");
  });

  it("keeps aliases when destructuring the result of a use* function", () => {
    const output = transform(`
      export function Counter() {
        const { count, increment } = useCounter();
        return <button onClick={() => increment()}>{count}</button>;
      }
    `).replace(/\s+/g, " ");

    expect(output).toContain("const _hook = useCounter()");
    expect(output).toContain("const __prop_0 = () => _hook.count");
    expect(output).toContain("__prop_1()()");
    expect(output).toContain("__dynText(() => __prop_0())");
  });

  it("calls a destructured function prop through its alias", () => {
    const output = transform(`
      export function Save({ onSave }) {
        return <button onClick={() => onSave(1)}>Save</button>;
      }
    `);

    expect(output).toContain("__prop_0()(1)");
  });

  it("transforms use* functions in plain .ts files and skips everything else there", () => {
    const run = (code: string, id: string) =>
      (helMagicPlugin().transform as unknown as (code: string, id: string) => { code: string } | null).call({}, code, id);

    const hook = "export function useCounter<T>(value: T) { let count = 0; return { count, value: value as T }; }";
    expect(run(hook, "C:/app/src/counter.ts")?.code).toContain("__cell(");
    expect(run("export function add(a: number) { let b = a; return b; }", "C:/app/src/math.ts")).toBeNull();
    expect(run(hook, "C:/app/src/types.d.ts")).toBeNull();
    expect(run(hook, "C:/repo/src/framework/runtime/core.ts")).toBeNull();
  });

  it("transforms anonymous default exports and wrapped components", () => {
    expect(transform("export default () => { let c = 0; return <p>{c}</p>; };")).toContain("__cell(");
    expect(transform("export default function () { let c = 0; return <p>{c}</p>; }")).toContain("__cell(");
    expect(transform("const C = wrap(() => { let c = 0; return <p>{c}</p>; });")).toContain("__cell(");
  });

  it("warns when JSX reads a module-level let", () => {
    const warnings: string[] = [];
    const handler = helMagicPlugin().transform as unknown as (
      this: { warn: (message: string) => void },
      code: string,
      id: string,
    ) => unknown;

    handler.call(
      { warn: (message: string) => warnings.push(message) },
      "let total = 0; export function Total() { return <p>{total}{total}</p>; }",
      "Total.tsx",
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('module-level let "total"');
  });

  it("rewrites reactive const derivations into internal derived helpers", () => {
    const output = transform(`
      export function Counter() {
        let count = 0;
        const label = count % 2 === 0 ? "even" : "odd";
        return <p>{label}</p>;
      }
    `);

    expect(output).toContain("const __derived_label_0 = __memo(() =>");
    expect(output).toContain("__get(__cell_count_0) % 2 === 0 ? \"even\" : \"odd\"");
    expect(output).toContain("__dynText(() => __derived_label_0())");
  });
});
