import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cell,
  createContext,
  effect,
  For,
  get,
  list,
  mount,
  onCleanup,
  set,
  store,
  useContext,
} from "hel/runtime";

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

describe("compiled JSX regressions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("reactive writes", () => {
    it("swaps reactive lets through destructuring assignment", async () => {
      const root = createRoot();

      function Swap() {
        let a = 1;
        let b = 2;
        return <button onClick={() => { [a, b] = [b, a]; }}>{a}-{b}</button>;
      }

      mount(() => <Swap />, root);
      click(root.querySelector("button"));
      await flush();

      expect(root.textContent).toBe("2-1");
    });

    it("writes reactive lets through object destructuring with rest and defaults", async () => {
      const root = createRoot();

      function Destructure() {
        let a = 0;
        let b = 0;
        let rest: unknown[] = [];
        return (
          <button onClick={() => { ({ a, b = 9 } = { a: 1 } as { a: number; b?: number }); [, ...rest] = [0, 1, 2]; }}>
            {a}-{b}-{rest.length}
          </button>
        );
      }

      mount(() => <Destructure />, root);
      click(root.querySelector("button"));
      await flush();

      expect(root.textContent?.trim()).toBe("1-9-2");
    });

    it("assigns reactive lets as for-of targets", async () => {
      const root = createRoot();

      function Loop() {
        let last = 0;
        return <button onClick={() => { for (last of [1, 2]) { /* assign only */ } }}>{last}</button>;
      }

      mount(() => <Loop />, root);
      click(root.querySelector("button"));
      await flush();

      expect(root.textContent).toBe("2");
    });
  });

  describe("conditional branches", () => {
    it("reacts to the inner condition of a nested ternary", async () => {
      const root = createRoot();
      let setInner: (value: boolean) => void = () => {};

      function Nested() {
        let outer = false;
        let inner = false;
        setInner = (value) => {
          inner = value;
        };
        return <div>{outer ? <i>A</i> : inner ? <i>B</i> : <i>C</i>}</div>;
      }

      mount(() => <Nested />, root);
      expect(root.textContent).toBe("C");

      setInner(true);
      await flush();

      expect(root.textContent).toBe("B");
    });

    it("updates a mapped list inside a ternary when the array changes", async () => {
      const root = createRoot();
      let add: () => void = () => {};

      function Items() {
        let open = true;
        let items = ["a"];
        add = () => {
          items = [...items, "b"];
        };
        return <ul>{open ? items.map((item) => <li>{item}</li>) : null}</ul>;
      }

      mount(() => <Items />, root);
      expect(root.querySelectorAll("li").length).toBe(1);

      add();
      await flush();

      expect(root.querySelectorAll("li").length).toBe(2);
    });

    it("keeps a plain value in a ternary arm reactive", async () => {
      const root = createRoot();
      let increment: () => void = () => {};

      function Value() {
        let visible = false;
        let count = 0;
        increment = () => {
          count++;
        };
        return <div>{visible ? <b>x</b> : count}</div>;
      }

      mount(() => <Value />, root);
      increment();
      await flush();

      expect(root.textContent).toBe("1");
    });

    it("shows the latest value when a hidden arm is reopened", async () => {
      const root = createRoot();
      let toggle: () => void = () => {};
      let add: () => void = () => {};

      function Retained() {
        let open = true;
        let items = ["a"];
        toggle = () => {
          open = !open;
        };
        add = () => {
          items = [...items, "b"];
        };
        return <ul>{open ? items.map((item) => <li>{item}</li>) : <li>closed</li>}</ul>;
      }

      mount(() => <Retained />, root);

      toggle();
      await flush();
      expect(root.textContent).toBe("closed");

      add();
      await flush();
      expect(root.textContent).toBe("closed");

      toggle();
      await flush();
      expect(root.textContent).toBe("ab");
    });

    it("updates branches rendered at the top level of a fragment", async () => {
      const root = createRoot();
      let toggle: () => void = () => {};

      function Multi() {
        let on = false;
        toggle = () => {
          on = !on;
        };
        return (
          <>
            {on ? <i>on</i> : <i>off</i>}
            <span>!</span>
          </>
        );
      }

      mount(() => <Multi />, root);
      expect(root.textContent).toBe("off!");

      toggle();
      await flush();

      expect(root.textContent).toBe("on!");
    });
  });

  describe("JSX passed through props", () => {
    it("renders {props.children} as elements", () => {
      const root = createRoot();

      function Box(props: { children?: unknown }) {
        return <div>{props.children}</div>;
      }

      mount(() => <Box><b>hi</b></Box>, root);

      expect(root.querySelector("b")?.textContent).toBe("hi");
    });

    it("renders JSX passed through a named prop", () => {
      const root = createRoot();

      function Card(props: { icon?: unknown }) {
        return <div>{props.icon}</div>;
      }

      mount(() => <Card icon={<b>hi</b>} />, root);

      expect(root.querySelector("b")?.textContent).toBe("hi");
    });

    it("switches a text slot to elements when a prop value becomes JSX later", async () => {
      const root = createRoot();
      let show: () => void = () => {};

      function Card(props: { icon?: unknown }) {
        return <div>{props.icon}</div>;
      }

      function App() {
        let visible = false;
        show = () => {
          visible = true;
        };
        return <Card icon={visible ? <b>hi</b> : null} />;
      }

      mount(() => <App />, root);
      expect(root.querySelector("b")).toBeNull();

      show();
      await flush();

      expect(root.querySelector("b")?.textContent).toBe("hi");
    });

    it("renders elements returned by a helper from outside the component", () => {
      const root = createRoot();

      function createBold(value: number) {
        const element = document.createElement("b");
        element.textContent = String(value);
        return element;
      }

      function Row() {
        let value = 1;
        return <div>{createBold(value)}</div>;
      }

      mount(() => <Row />, root);

      expect(root.querySelector("b")?.textContent).toBe("1");
    });
  });

  describe("keyed lists", () => {
    it("moves list() nodes by key on reorder", async () => {
      const root = createRoot();
      let reverse: () => void = () => {};

      function Rows() {
        let items = [{ id: "a" }, { id: "b" }];
        reverse = () => {
          items = [...items].reverse();
        };
        return <ul>{list(() => items, (item) => item.id, (item) => <li>{item.id}</li>)}</ul>;
      }

      mount(() => <Rows />, root);
      const first = root.querySelectorAll("li")[0];

      reverse();
      await flush();

      const after = root.querySelectorAll("li");
      expect(after[0]?.textContent).toBe("b");
      expect(after[1]).toBe(first);
    });

    it("moves <For key> nodes by key on reorder", async () => {
      const root = createRoot();
      let reverse: () => void = () => {};

      function Rows() {
        let items = [{ id: "a" }, { id: "b" }];
        reverse = () => {
          items = [...items].reverse();
        };
        return (
          <ul>
            <For each={items} key={(item: { id: string }) => item.id}>
              {(item: { id: string }) => <li>{item.id}</li>}
            </For>
          </ul>
        );
      }

      mount(() => <Rows />, root);
      const first = root.querySelectorAll("li")[0];

      reverse();
      await flush();

      const after = root.querySelectorAll("li");
      expect(after[0]?.textContent).toBe("b");
      expect(after[1]).toBe(first);
    });

    it("keeps row state with its key on reorder", async () => {
      const root = createRoot();
      let reverse: () => void = () => {};

      function Row(props: { id: string }) {
        const { id } = props;
        let count = 0;
        return <li onClick={() => count++}>{id}:{count}</li>;
      }

      function Rows() {
        let items = [{ id: "a" }, { id: "b" }];
        reverse = () => {
          items = [...items].reverse();
        };
        return <ul>{list(() => items, (item) => item.id, (item) => <Row id={item.id} />)}</ul>;
      }

      mount(() => <Rows />, root);
      click(root.querySelectorAll("li")[0]);
      await flush();
      expect(root.querySelectorAll("li")[0]?.textContent).toBe("a:1");

      reverse();
      await flush();

      expect(root.querySelectorAll("li")[1]?.textContent).toBe("a:1");
    });

    it("updates a keyed row when a store item it read is mutated", async () => {
      const root = createRoot();
      const todos = store([{ id: "a", title: "one" }]);

      function Rows() {
        return (
          <ul>
            <For each={[...todos]} key={(todo: { id: string }) => todo.id}>
              {(todo: { title: string }) => <li>{todo.title}</li>}
            </For>
          </ul>
        );
      }

      mount(() => <Rows />, root);
      todos[0]!.title = "two";
      await flush();

      expect(root.textContent).toBe("two");
    });

    it("renders keyed For fallback and swaps it for rows", async () => {
      const root = createRoot();
      let add: () => void = () => {};

      function Rows() {
        let items: Array<{ id: string }> = [];
        add = () => {
          items = [{ id: "a" }];
        };
        return (
          <ul>
            <For each={items} key={(item: { id: string }) => item.id} fallback={<li>empty</li>}>
              {(item: { id: string }) => <li>{item.id}</li>}
            </For>
          </ul>
        );
      }

      mount(() => <Rows />, root);
      expect(root.textContent).toBe("empty");

      add();
      await flush();

      expect(root.textContent).toBe("a");
    });

    it("disposes rows when the keyed list leaves the tree", async () => {
      const root = createRoot();
      let cleaned = 0;
      let hide: () => void = () => {};
      const items = [{ id: "a" }];

      function Row() {
        onCleanup(() => {
          cleaned += 1;
        });
        return <li>row</li>;
      }

      function Rows() {
        let show = true;
        hide = () => {
          show = false;
        };
        return <div>{show && <ul>{list(() => items, (item) => item.id, () => <Row />)}</ul>}</div>;
      }

      mount(() => <Rows />, root);
      expect(root.querySelectorAll("li").length).toBe(1);

      hide();
      await flush();

      expect(cleaned).toBe(1);
    });
  });

  describe("block slots", () => {
    it("keeps a child with local state interactive after its block re-renders", async () => {
      const root = createRoot();
      let rename: () => void = () => {};

      function Row(props: { label: string }) {
        const { label } = props;
        let count = 0;
        return <button onClick={() => count++}>{label}:{count}</button>;
      }

      function Rows() {
        let rows = ["a"];
        rename = () => {
          rows = ["b"];
        };
        return <div>{rows.map((row) => <Row label={row} />)}</div>;
      }

      mount(() => <Rows />, root);

      rename();
      await flush();
      expect(root.textContent).toBe("b:0");

      click(root.querySelector("button"));
      await flush();
      expect(root.textContent).toBe("b:1");
    });

    it("shows the latest render when repeated re-renders contain nested slots", async () => {
      const root = createRoot();
      let rename: (value: string) => void = () => {};

      function Rows() {
        let rows = ["a"];
        let flag = true;
        rename = (value) => {
          rows = [value];
        };
        return <div>{rows.map((row) => <section><b>{row}</b>{flag ? <i>on</i> : <i>off</i>}</section>)}</div>;
      }

      mount(() => <Rows />, root);

      rename("b");
      await flush();
      rename("c");
      await flush();

      expect(root.querySelector("b")?.textContent).toBe("c");
    });
  });

  describe("context", () => {
    const Theme = createContext("default");

    function Consumer() {
      const value = useContext(Theme);
      return <p>{value}</p>;
    }

    it("reaches a consumer mounted later inside a ternary", async () => {
      const root = createRoot();
      let show: () => void = () => {};

      function Toggle() {
        let visible = false;
        show = () => {
          visible = true;
        };
        return <div>{visible ? <Consumer /> : <span>none</span>}</div>;
      }

      mount(() => <Theme.Provider value="provided"><Toggle /></Theme.Provider>, root);
      show();
      await flush();

      expect(root.textContent).toBe("provided");
    });

    it("reaches a consumer mounted later inside &&", async () => {
      const root = createRoot();
      let show: () => void = () => {};

      function Toggle() {
        let visible = false;
        show = () => {
          visible = true;
        };
        return <div>{visible && <Consumer />}</div>;
      }

      mount(() => <Theme.Provider value="provided"><Toggle /></Theme.Provider>, root);
      show();
      await flush();

      expect(root.textContent).toBe("provided");
    });

    it("reaches a consumer added to a keyed list later", async () => {
      const root = createRoot();
      let add: () => void = () => {};

      function Rows() {
        let items: Array<{ id: string }> = [];
        add = () => {
          items = [{ id: "a" }];
        };
        return <div>{list(() => items, (item) => item.id, () => <Consumer />)}</div>;
      }

      mount(() => <Theme.Provider value="provided"><Rows /></Theme.Provider>, root);
      add();
      await flush();

      expect(root.textContent).toBe("provided");
    });
  });

  describe("controls", () => {
    it("toggles a simple ternary", async () => {
      const root = createRoot();
      let toggle: () => void = () => {};

      function Simple() {
        let on = false;
        toggle = () => {
          on = !on;
        };
        return <div>{on ? <i>A</i> : <i>B</i>}</div>;
      }

      mount(() => <Simple />, root);
      toggle();
      await flush();

      expect(root.textContent).toBe("A");
    });

    it("renders destructured children", () => {
      const root = createRoot();

      function Box({ children }: { children?: unknown }) {
        return <div>{children}</div>;
      }

      mount(() => <Box><b>hi</b></Box>, root);

      expect(root.querySelector("b")?.textContent).toBe("hi");
    });

    it("provides context to an immediately mounted consumer", () => {
      const root = createRoot();
      const Theme = createContext("default");

      function Consumer() {
        const value = useContext(Theme);
        return <p>{value}</p>;
      }

      mount(() => <Theme.Provider value="provided"><Consumer /></Theme.Provider>, root);

      expect(root.textContent).toBe("provided");
    });

    it("runs cleanup when an && branch is hidden", async () => {
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
        return <div>{show && <Child />}</div>;
      }

      mount(() => <Toggle />, root);
      toggle();
      await flush();

      expect(cleaned).toBe(1);
    });
  });

  // Each of these documents a bug that is still open. When one gets fixed,
  // it.fails turns red: replace it with a plain it.
  describe("known open bugs", () => {
    it("keeps the space between two expressions", () => {
      const root = createRoot();

      function Name() {
        const first = "x";
        const last = "y";
        return <p>{first} {last}</p>;
      }

      mount(() => <Name />, root);

      expect(root.textContent).toBe("x y");
    });

    it("keeps spaces around inline elements in static templates", () => {
      const root = createRoot();

      function Copy() {
        return <div><p>Hello <b>world</b> again</p></div>;
      }

      mount(() => <Copy />, root);

      expect(root.textContent).toBe("Hello world again");
    });

    it("maps htmlFor to for in static templates", () => {
      const root = createRoot();

      function Field() {
        return <div><label htmlFor="name">Name</label></div>;
      }

      mount(() => <Field />, root);

      expect(root.querySelector("label")?.getAttribute("for")).toBe("name");
    });

    it("creates SVG elements in the SVG namespace", () => {
      const root = createRoot();

      function Icon() {
        let radius = 3;
        return <svg viewBox="0 0 10 10"><circle r={radius} /></svg>;
      }

      mount(() => <Icon />, root);

      expect(root.querySelector("circle")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    });

    it.fails("supports Date values in a store", () => {
      expect(store({ date: new Date(0) }).date.getTime()).toBe(0);
    });

    it.fails("supports Map values in a store", () => {
      expect(store({ map: new Map([["a", 1]]) }).map.get("a")).toBe(1);
    });
  });
});

describe("effect regressions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not run or resubscribe an effect disposed while queued", async () => {
    const value = cell(0);
    let runs = 0;
    const stop = effect(() => {
      get(value);
      runs += 1;
    });

    set(value, 1);
    stop();
    await flush();
    expect(runs).toBe(1);

    set(value, 2);
    await flush();
    expect(runs).toBe(1);
  });

  it("runs the remaining effects and reports the error when one throws", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);

    const value = cell(0);
    let other = 0;
    effect(() => {
      if (get(value) === 1) {
        throw new Error("boom");
      }
    });
    effect(() => {
      get(value);
      other += 1;
    });

    set(value, 1);
    await flush();

    expect(other).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
    expect((report.mock.calls[0]![0] as Error).message).toBe("boom");
  });

  it("does not replay earlier effects in later flushes after one threw", async () => {
    vi.stubGlobal("reportError", vi.fn());

    const failing = cell(0);
    const unrelated = cell(0);
    let failingRuns = 0;
    let unrelatedRuns = 0;
    effect(() => {
      failingRuns += 1;
      if (get(failing) === 1) {
        throw new Error("boom");
      }
    });
    effect(() => {
      get(unrelated);
      unrelatedRuns += 1;
    });

    set(failing, 1);
    await flush();
    const failingRunsAfterThrow = failingRuns;

    set(unrelated, 1);
    await flush();

    expect(unrelatedRuns).toBe(2);
    expect(failingRuns).toBe(failingRunsAfterThrow);
  });
});
