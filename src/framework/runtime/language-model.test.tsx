import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cell,
  createContext,
  dynAttr,
  dynBlock,
  effect,
  get,
  h,
  memo,
  mount,
  onCleanup,
  set,
  store,
  untrack,
  useContext,
} from "heljs/runtime";

const flush = async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const createRoot = () => {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
};

const click = (element: Element | null | undefined) =>
  element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const moduleStore = store({ count: 0 });
const readModuleStore = () => moduleStore.count;

// Compiled as hooks because of their names.
function useCounter(start = 0) {
  let count = start;
  const doubled = count * 2;
  function increment() {
    count++;
  }
  return { count, doubled, increment };
}

function useCart() {
  let items: Array<{ price: number }> = [];
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const isEmpty = items.length === 0;
  function add(price: number) {
    items = [...items, { price }];
  }
  return { items, total, isEmpty, add };
}

const sharedCart = useCart();

beforeEach(() => {
  document.body.innerHTML = "";
  moduleStore.count = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decision 1: dynamic by default", () => {
  it("updates from a module-level store", async () => {
    const root = createRoot();

    function Count() {
      return <p>{moduleStore.count}</p>;
    }

    mount(() => <Count />, root);
    moduleStore.count = 1;
    await flush();

    expect(root.textContent).toBe("1");
  });

  it("updates from a store provided through context", async () => {
    const root = createRoot();
    const shared = store({ count: 0 });
    const Shared = createContext(shared);

    function Count() {
      const value = useContext(Shared);
      return <p>{value.count}</p>;
    }

    mount(() => <Count />, root);
    shared.count = 1;
    await flush();

    expect(root.textContent).toBe("1");
  });

  it("updates through a helper from outside the component", async () => {
    const root = createRoot();

    function Count() {
      return <p title={String(readModuleStore())}>{readModuleStore()}</p>;
    }

    mount(() => <Count />, root);
    moduleStore.count = 2;
    await flush();

    expect(root.textContent).toBe("2");
    expect(root.querySelector("p")?.getAttribute("title")).toBe("2");
  });

  it("updates JSX created by a lowercase helper", async () => {
    const root = createRoot();
    const item = store({ title: "one" });
    const row = () => <li>{item.title}</li>;

    function List() {
      return <ul>{row()}</ul>;
    }

    mount(() => <List />, root);
    item.title = "two";
    await flush();

    expect(root.textContent).toBe("two");
  });

  it("unwraps a binding returned by a helper in an attribute", async () => {
    const root = createRoot();
    const active = cell(true);
    const router = { isActive: () => dynAttr(() => get(active)) };

    function Link() {
      return <a data-active={router.isActive()}>x</a>;
    }

    mount(() => <Link />, root);
    expect(root.querySelector("a")?.hasAttribute("data-active")).toBe(true);

    set(active, false);
    await flush();

    expect(root.querySelector("a")?.hasAttribute("data-active")).toBe(false);
  });

  it("keeps a block static when its slots have no dependencies", async () => {
    const root = createRoot();
    const data = { title: "one" };
    const rows = cell(["a"]);

    function Row() {
      return <span>{data.title}</span>;
    }

    mount(
      () => h("section", null, dynBlock(() => get(rows).map((row) => h("p", { title: row }, h(Row, null))))),
      root,
    );

    const paragraph = root.querySelector("p");
    set(rows, ["b"]);
    await flush();

    expect(root.querySelector("p")).toBe(paragraph);
    expect(paragraph?.getAttribute("title")).toBe("b");
  });

  it("patches stateless components in place, keeping focus", async () => {
    const root = createRoot();
    let rename: () => void = () => {};

    function Field() {
      return <input />;
    }

    function Form() {
      let label = "a";
      rename = () => {
        label = "b";
      };
      return <div>{[label].map((value) => <label title={value}><Field /></label>)}</div>;
    }

    mount(() => <Form />, root);
    const input = root.querySelector("input")!;
    input.focus();

    rename();
    await flush();

    expect(root.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(root.querySelector("label")?.getAttribute("title")).toBe("b");
  });
});

describe("decision 2: const stays live and is computed once per change", () => {
  it("keeps every form of derived const up to date", async () => {
    const root = createRoot();
    let bump: () => void = () => {};

    function Values(props: { start: number }) {
      let count = 0;
      const helper = () => count;
      const bare = count;
      const expr = count + 1;
      const viaHelper = helper();
      const chained = expr * 2;
      const alias = props.start;
      bump = () => {
        count = 5;
      };
      return <p>{bare}|{expr}|{viaHelper}|{chained}|{alias}</p>;
    }

    mount(() => <Values start={7} />, root);
    expect(root.textContent).toBe("0|1|0|2|7");

    bump();
    await flush();

    expect(root.textContent).toBe("5|6|5|12|7");
  });

  it("computes once per change, however often it is read", async () => {
    const root = createRoot();
    let calls = 0;
    let bump: () => void = () => {};
    const compute = (value: number) => {
      calls += 1;
      return value * 2;
    };

    function Values() {
      let count = 1;
      const doubled = compute(count);
      bump = () => {
        count += 1;
      };
      return <p title={String(doubled)}>{doubled}|{doubled}</p>;
    }

    mount(() => <Values />, root);
    expect(calls).toBe(1);

    bump();
    await flush();

    expect(calls).toBe(2);
    expect(root.textContent).toBe("4|4");
  });

  it("gives a handler the fresh value right after a write", async () => {
    const root = createRoot();
    const seen: number[] = [];

    function Values() {
      let count = 0;
      const doubled = count * 2;
      return <button onClick={() => { count = 5; seen.push(doubled); }}>x</button>;
    }

    mount(() => <Values />, root);
    click(root.querySelector("button"));
    await flush();

    expect(seen).toEqual([10]);
  });

  it("keeps object identity until a dependency changes", async () => {
    const root = createRoot();
    const seen: unknown[] = [];
    let read: () => void = () => {};
    let bump: () => void = () => {};

    function Values() {
      let count = 0;
      const box = { count };
      read = () => seen.push(box);
      bump = () => {
        count += 1;
      };
      return <p>{box.count}</p>;
    }

    mount(() => <Values />, root);
    read();
    read();
    expect(seen[0]).toBe(seen[1]);

    bump();
    await flush();
    read();

    expect(seen[2]).not.toBe(seen[1]);
    expect(root.textContent).toBe("1");
  });

  it("offers untrack as the explicit snapshot", async () => {
    const root = createRoot();
    let bump: () => void = () => {};

    function Values() {
      let count = 1;
      const initial = untrack(() => count);
      bump = () => {
        count = 2;
      };
      return <p>{initial}|{count}</p>;
    }

    mount(() => <Values />, root);
    bump();
    await flush();

    expect(root.textContent).toBe("1|2");
  });

  it("creates a JSX const once", () => {
    const root = createRoot();
    let created = 0;
    const mark = () => {
      created += 1;
      return "x";
    };

    function Values() {
      const element = <i>{mark()}</i>;
      return <div>{element}</div>;
    }

    mount(() => <Values />, root);

    expect(root.querySelectorAll("i").length).toBe(1);
    expect(created).toBe(1);
  });

  it("does not re-run setup calls when their arguments change", async () => {
    const root = createRoot();
    let bump: () => void = () => {};
    let created = 0;

    class Thing {
      constructor(public value: number) {
        created += 1;
      }
    }

    function Values() {
      let count = 0;
      const thing = new Thing(count);
      const state = store({ value: count });
      bump = () => {
        count = 1;
      };
      return <p>{thing.value}|{state.value}|{count}</p>;
    }

    mount(() => <Values />, root);
    bump();
    await flush();

    expect(created).toBe(1);
    expect(root.textContent).toBe("0|0|1");
  });

  it("notifies memo dependents through the normal effect flush", async () => {
    const value = cell(1);
    const doubled = memo(() => get(value) * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(doubled());
    });

    set(value, 2);
    set(value, 3);
    expect(doubled()).toBe(6);
    await flush();

    expect(seen).toEqual([2, 6]);
  });

  it("disposes what a derived value created when it recomputes", async () => {
    const root = createRoot();
    let cleaned = 0;
    let bump: () => void = () => {};

    function Child() {
      onCleanup(() => {
        cleaned += 1;
      });
      return <b>child</b>;
    }

    function Values() {
      let on = true;
      const content = on ? <Child /> : <i>off</i>;
      bump = () => {
        on = false;
      };
      return <div>{content}</div>;
    }

    mount(() => <Values />, root);
    expect(root.textContent).toBe("child");

    bump();
    await flush();

    expect(root.textContent).toBe("off");
    expect(cleaned).toBe(1);
  });
});

describe("decision 3: use* functions", () => {
  it("shares reactive logic through a hook", async () => {
    const root = createRoot();

    function Counter() {
      const counter = useCounter(1);
      return <button onClick={() => counter.increment()}>{counter.count}|{counter.doubled}</button>;
    }

    mount(() => <Counter />, root);
    expect(root.textContent).toBe("1|2");

    click(root.querySelector("button"));
    await flush();

    expect(root.textContent).toBe("2|4");
  });

  it("keeps destructured hook results reactive", async () => {
    const root = createRoot();

    function Counter() {
      const { count, doubled, increment } = useCounter();
      return <button onClick={() => increment()}>{count}|{doubled}</button>;
    }

    mount(() => <Counter />, root);
    click(root.querySelector("button"));
    await flush();

    expect(root.textContent).toBe("1|2");
  });

  it("gives each hook call its own state", async () => {
    const root = createRoot();

    function Counter() {
      const first = useCounter();
      const second = useCounter();
      return <button onClick={() => first.increment()}>{first.count}|{second.count}</button>;
    }

    mount(() => <Counter />, root);
    click(root.querySelector("button"));
    await flush();

    expect(root.textContent).toBe("1|0");
  });

  it("throws on writes through a hook result", () => {
    const counter = useCounter() as { count: number };

    expect(() => {
      counter.count = 5;
    }).toThrow(TypeError);
  });

  it("shares a module-level hook instance across components", async () => {
    const root = createRoot();

    function Badge() {
      return <b>{sharedCart.isEmpty ? "empty" : `${sharedCart.items.length} / ${sharedCart.total}`}</b>;
    }

    function Buy() {
      return <button onClick={() => sharedCart.add(5)}>buy</button>;
    }

    function Shop() {
      return <main><Badge /><Buy /></main>;
    }

    mount(() => <Shop />, root);
    expect(root.querySelector("b")?.textContent).toBe("empty");

    click(root.querySelector("button"));
    await flush();
    click(root.querySelector("button"));
    await flush();

    expect(root.querySelector("b")?.textContent).toBe("2 / 10");
  });

  it("calls a destructured function prop", () => {
    const root = createRoot();
    const save = vi.fn();

    function Save({ onSave }: { onSave: (value: number) => void }) {
      return <button onClick={() => onSave(1)}>save</button>;
    }

    mount(() => <Save onSave={save} />, root);
    click(root.querySelector("button"));

    expect(save).toHaveBeenCalledWith(1);
  });
});

describe("decision 4: setup is untracked", () => {
  it("does not loop when setup reads and writes a let inside a block", async () => {
    const root = createRoot();
    let renders = 0;
    let show: () => void = () => {};

    function Child() {
      renders += 1;
      if (renders > 50) {
        throw new Error("render loop");
      }
      let total = 0;
      for (const value of [1, 2]) {
        total += value;
      }
      return <b>{total}</b>;
    }

    function App() {
      let visible = false;
      show = () => {
        visible = true;
      };
      return <div>{visible && <Child />}</div>;
    }

    mount(() => <App />, root);
    show();
    await flush();

    expect(renders).toBe(1);
    expect(root.textContent).toBe("3");
  });

  it("does not re-render when setup reads a store", async () => {
    const root = createRoot();
    let renders = 0;
    const state = store({ count: 0 });

    function Child() {
      renders += 1;
      void untrackedRead();
      return <b>child</b>;
    }

    const untrackedRead = () => state.count;

    function App() {
      let visible = true;
      return <div onClick={() => (visible = !visible)}>{visible && <Child />}</div>;
    }

    mount(() => <App />, root);
    state.count += 1;
    await flush();

    expect(renders).toBe(1);
  });

  it("still re-renders uncompiled components when their props change", async () => {
    const root = createRoot();
    const value = cell("a");

    const plain = (props: { label: string }) => h("b", null, props.label);

    mount(() => h("div", null, h(plain, { label: dynAttr(() => get(value)) })), root);
    expect(root.textContent).toBe("a");

    set(value, "b");
    await flush();

    expect(root.textContent).toBe("b");
  });

  it("stops runaway effects with a clear error instead of hanging", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);

    const value = cell(0);
    let runs = 0;
    effect(() => {
      runs += 1;
      set(value, get(value) + 1);
    });
    await flush();

    expect(runs).toBeLessThanOrEqual(102);
    expect(report).toHaveBeenCalledTimes(1);
    expect((report.mock.calls[0]![0] as Error).message).toContain("kept triggering each other");
  });
});

describe("decision 5: hidden branches are disposed", () => {
  it("runs onCleanup when a ternary branch is hidden", async () => {
    const root = createRoot();
    let cleaned = 0;
    let toggle: () => void = () => {};

    function Child() {
      onCleanup(() => {
        cleaned += 1;
      });
      return <p>child</p>;
    }

    function Toggle() {
      let show = true;
      toggle = () => {
        show = !show;
      };
      return <div>{show ? <Child /> : <span>none</span>}</div>;
    }

    mount(() => <Toggle />, root);
    toggle();
    await flush();

    expect(root.textContent).toBe("none");
    expect(cleaned).toBe(1);
  });

  it("starts with fresh local state when a ternary branch is reopened", async () => {
    const root = createRoot();
    let toggle: () => void = () => {};

    function Child() {
      let count = 0;
      return <button onClick={() => count++}>{count}</button>;
    }

    function Toggle() {
      let show = true;
      toggle = () => {
        show = !show;
      };
      return <div>{show ? <Child /> : <span>none</span>}</div>;
    }

    mount(() => <Toggle />, root);
    click(root.querySelector("button"));
    await flush();
    expect(root.querySelector("button")?.textContent).toBe("1");

    toggle();
    await flush();
    toggle();
    await flush();

    expect(root.querySelector("button")?.textContent).toBe("0");
  });

  it("stops updating a hidden branch", async () => {
    const root = createRoot();
    const value = cell(0);
    let reads = 0;
    let toggle: () => void = () => {};
    const read = () => {
      reads += 1;
      return get(value);
    };

    function Toggle() {
      let show = true;
      toggle = () => {
        show = !show;
      };
      return <div>{show ? <p>{read()}</p> : <span>none</span>}</div>;
    }

    mount(() => <Toggle />, root);
    toggle();
    await flush();
    const readsWhileHidden = reads;

    set(value, 1);
    await flush();

    expect(reads).toBe(readsWhileHidden);
  });

  it("treats ternary and && the same, with or without nested slots", async () => {
    const root = createRoot();
    const cleaned: string[] = [];
    let toggle: () => void = () => {};

    function Nested(props: { name: string; on: boolean }) {
      const { name, on } = props;
      onCleanup(() => {
        cleaned.push(name);
      });
      return <section>{on ? <i>on</i> : <i>off</i>}</section>;
    }

    function Toggle() {
      let show = true;
      let on = true;
      toggle = () => {
        show = !show;
      };
      return (
        <div>
          {show ? <Nested name="ternary" on={on} /> : null}
          {show && <Nested name="and" on={on} />}
        </div>
      );
    }

    mount(() => <Toggle />, root);
    toggle();
    await flush();

    expect(cleaned.sort()).toEqual(["and", "ternary"]);
  });
});
