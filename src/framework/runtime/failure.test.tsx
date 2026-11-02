import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, effect, list, mount, onCleanup, onMount, useContext } from "hel/runtime";

const flush = async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const createRoot = () => {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
};

const reported: unknown[] = [];
const messages = () => reported.map((error) => (error as Error).message);

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  reported.length = 0;
  document.body.innerHTML = "";
  vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

describe("onMount", () => {
  it("sees the provider and registers cleanups", async () => {
    const Theme = createContext("default");
    const controls: { hide?: () => void } = {};
    const cleaned: string[] = [];
    let seen = "";

    function Child() {
      onMount(() => {
        seen = useContext(Theme);
        onCleanup(() => cleaned.push("from mount"));
      });
      return <i>child</i>;
    }

    function App() {
      let visible = true;
      controls.hide = () => {
        visible = false;
      };
      return <Theme.Provider value="provided"><div>{visible && <Child />}</div></Theme.Provider>;
    }

    mount(() => <App />, createRoot());
    await flush();
    controls.hide!();
    await flush();

    expect(seen).toBe("provided");
    expect(cleaned).toEqual(["from mount"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when onCleanup and useContext run after an await", async () => {
    const Theme = createContext("default");

    function Child() {
      onMount(async () => {
        await null;
        useContext(Theme);
        onCleanup(() => {});
      });
      return <i>child</i>;
    }

    mount(() => <Child />, createRoot());
    await flush();

    const warnings = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(warnings.some((text: string) => text.includes("useContext()"))).toBe(true);
    expect(warnings.some((text: string) => text.includes("onCleanup()"))).toBe(true);
  });

  it("runs the remaining mounts when one throws", async () => {
    const ran: string[] = [];

    function First() {
      onMount(() => {
        ran.push("first");
        throw new Error("mount failed");
      });
      onMount(() => {
        ran.push("second");
      });
      return <i>a</i>;
    }

    function Second() {
      onMount(() => {
        ran.push("other component");
      });
      return <i>b</i>;
    }

    mount(() => <div><First /><Second /></div>, createRoot());
    await flush();

    expect(ran).toEqual(["first", "second", "other component"]);
    expect(messages()).toEqual(["mount failed"]);
  });
});

describe("a failing cleanup", () => {
  it("does not stop the others or the slot", async () => {
    const root = createRoot();
    const controls: { hide?: () => void; change?: () => void } = {};
    const ran: string[] = [];

    function Child() {
      let count = 0;
      controls.change = () => {
        count += 1;
      };
      effect(() => {
        ran.push(`effect ${count}`);
      });
      onCleanup(() => ran.push("first cleanup"));
      onCleanup(() => {
        throw new Error("cleanup failed");
      });
      return <i>child</i>;
    }

    function App() {
      let visible = true;
      controls.hide = () => {
        visible = false;
      };
      return <div>{visible ? <Child /> : <b>other</b>}</div>;
    }

    mount(() => <App />, root);
    controls.hide!();
    await flush();

    expect(root.textContent).toBe("other");
    expect(ran).toEqual(["effect 0", "first cleanup"]);
    expect(messages()).toEqual(["cleanup failed"]);

    controls.change!();
    await flush();
    expect(ran).not.toContain("effect 1");
  });
});

describe("a failing component setup", () => {
  it("releases what it already created", async () => {
    const controls: { change?: () => void; retry?: () => void } = {};
    const ran: string[] = [];
    let fail = true;

    function Half(props: { count: number }): any {
      effect(() => {
        ran.push(`effect ${props.count}`);
      });
      onCleanup(() => ran.push("cleanup"));
      if (fail) {
        throw new Error("half done");
      }
      return <i>done</i>;
    }

    function App() {
      let count = 0;
      let visible = false;
      controls.change = () => {
        count += 1;
      };
      controls.retry = () => {
        visible = true;
      };
      return <div>{visible ? <Half count={count} /> : <b>idle</b>}</div>;
    }

    mount(() => <App />, createRoot());
    controls.retry!();
    await flush();

    expect(ran).toEqual(["effect 0", "cleanup"]);
    expect(messages()).toEqual(["half done"]);

    controls.change!();
    await flush();
    expect(ran).toEqual(["effect 0", "cleanup"]);

    fail = false;
  });
});

describe("a failing slot without a boundary", () => {
  it("empties a branch, and renders again when the next change works", async () => {
    const root = createRoot();
    const controls: { set?: (value: number) => void } = {};
    let fail = true;

    function Sometimes(): any {
      if (fail) {
        throw new Error("branch failed");
      }
      return <b>fine</b>;
    }

    function App() {
      let count = 0;
      controls.set = (value) => {
        count = value;
      };
      return <div>{count > 0 ? <Sometimes /> : <i>start</i>}</div>;
    }

    mount(() => <App />, root);
    controls.set!(1);
    await flush();

    expect(root.textContent).toBe("");
    expect(messages()).toEqual(["branch failed"]);

    fail = false;
    controls.set!(2);
    await flush();

    expect(root.textContent).toBe("fine");
  });

  it("does not leave dead content in a branch", async () => {
    const root = createRoot();
    const controls: { fail?: () => void } = {};

    function Bad(): any {
      throw new Error("branch failed");
    }

    function App() {
      let broken = false;
      controls.fail = () => {
        broken = true;
      };
      return <div>{broken ? <Bad /> : <b>alive</b>}</div>;
    }

    mount(() => <App />, root);
    controls.fail!();
    await flush();

    expect(root.querySelector("b")).toBeNull();
  });

  it("empties a block, and renders again when the next change works", async () => {
    const root = createRoot();
    const controls: { set?: (value: number) => void } = {};
    const render = (value: number) => {
      if (value === 2) {
        throw new Error("block failed");
      }
      return <em>{value}</em>;
    };

    function App() {
      let count = 1;
      controls.set = (value) => {
        count = value;
      };
      return <div>{render(count)}<u>after</u></div>;
    }

    mount(() => <App />, root);
    controls.set!(2);
    await flush();

    expect(root.querySelector("em")).toBeNull();
    expect(root.querySelector("u")?.textContent).toBe("after");

    controls.set!(3);
    await flush();

    expect(root.querySelector("em")?.textContent).toBe("3");
  });

  it("empties text, keeps its neighbours, and recovers", async () => {
    const root = createRoot();
    const controls: { set?: (value: number) => void; other?: (value: number) => void } = {};
    const format = (value: number) => {
      if (value === 2) {
        throw new Error("text failed");
      }
      return `v${value}`;
    };

    function App() {
      let count = 1;
      let other = 1;
      controls.set = (value) => {
        count = value;
      };
      controls.other = (value) => {
        other = value;
      };
      return <p>{format(count)}|{other}</p>;
    }

    mount(() => <App />, root);
    controls.set!(2);
    controls.other!(2);
    await flush();

    expect(root.textContent).toBe("|2");
    expect(messages()).toEqual(["text failed"]);

    controls.set!(3);
    await flush();

    expect(root.textContent).toBe("v3|2");
  });

  it("keeps the last attribute value", async () => {
    const root = createRoot();
    const controls: { set?: (value: number) => void } = {};
    const className = (value: number) => {
      if (value === 2) {
        throw new Error("attr failed");
      }
      return `c${value}`;
    };

    function App() {
      let count = 1;
      controls.set = (value) => {
        count = value;
      };
      return <p class={className(count)}>x</p>;
    }

    mount(() => <App />, root);
    controls.set!(2);
    await flush();

    expect(root.querySelector("p")?.className).toBe("c1");
    expect(messages()).toEqual(["attr failed"]);
  });

  it("disposes a first-run effect that threw", async () => {
    const controls: { set?: (value: number) => void } = {};
    const ran: number[] = [];

    function Inner(props: { count: number }): any {
      effect(() => {
        ran.push(props.count);
        throw new Error("effect failed");
      });
      return <i>never</i>;
    }

    function App() {
      let count = 0;
      let visible = false;
      controls.set = (value) => {
        count = value;
        visible = true;
      };
      return <div>{visible ? <Inner count={count} /> : <b>idle</b>}</div>;
    }

    mount(() => <App />, createRoot());
    controls.set!(1);
    await flush();
    expect(ran).toEqual([1]);

    controls.set!(2);
    await flush();

    // The branch stays on the same arm but renders again after its failure.
    expect(ran.filter((value) => value === 1)).toHaveLength(1);
  });
});

describe("a failing keyed list", () => {
  function setup() {
    const root = createRoot();
    const controls: { items?: (value: number[]) => void } = {};
    const created: number[] = [];
    const cleaned: number[] = [];

    function Row(props: { value: number }): any {
      created.push(props.value);
      onCleanup(() => cleaned.push(props.value));
      if (props.value === 99) {
        throw new Error("row failed");
      }
      return <li>{props.value}</li>;
    }

    function App() {
      let items = [1, 2];
      controls.items = (value) => {
        items = value;
      };
      return <ul>{list(() => items, (item) => item, (item) => <Row value={item} />)}</ul>;
    }

    mount(() => <App />, root);
    return { root, controls, created, cleaned };
  }

  it("keeps the old rows and releases the rows of the failed update", async () => {
    const { root, controls, cleaned } = setup();

    controls.items!([1, 2, 3, 99, 4]);
    await flush();

    expect(root.textContent).toBe("12");
    expect(cleaned.sort()).toEqual([3, 99]);
    expect(messages()).toEqual(["row failed"]);
  });

  it("recovers on the next update", async () => {
    const { root, controls } = setup();

    controls.items!([1, 99]);
    await flush();
    controls.items!([1, 5]);
    await flush();

    expect(root.textContent).toBe("15");
  });

  it("releases the rows when the first render of an empty list fails", async () => {
    const root = createRoot();
    const controls: { items?: (value: number[]) => void } = {};
    const cleaned: number[] = [];

    function Row(props: { value: number }): any {
      onCleanup(() => cleaned.push(props.value));
      if (props.value === 99) {
        throw new Error("row failed");
      }
      return <li>{props.value}</li>;
    }

    function App() {
      let items: number[] = [];
      controls.items = (value) => {
        items = value;
      };
      return <ul>{list(() => items, (item) => item, (item) => <Row value={item} />)}</ul>;
    }

    mount(() => <App />, root);
    controls.items!([1, 99]);
    await flush();

    expect(root.querySelector("li")).toBeNull();
    expect(cleaned.sort()).toEqual([1, 99]);
  });

  it("does not leave a dead row when it fails to render again", async () => {
    const root = createRoot();
    const controls: { items?: (value: Array<{ id: number; bad: boolean }>) => void } = {};

    function App() {
      let items = [{ id: 1, bad: false }, { id: 2, bad: false }];
      controls.items = (value) => {
        items = value;
      };
      return <ul>{list(() => items, (item) => item.id, (item) => {
        if (item.bad) {
          throw new Error("row failed");
        }
        return <li>{item.id}</li>;
      })}</ul>;
    }

    mount(() => <App />, root);
    controls.items!([{ id: 1, bad: true }, { id: 2, bad: false }]);
    await flush();

    expect(root.textContent).toBe("2");
    expect(messages()).toEqual(["row failed"]);

    controls.items!([{ id: 1, bad: false }, { id: 2, bad: false }]);
    await flush();

    expect(root.textContent).toBe("12");
  });
});

describe("promises", () => {
  it("cannot be rendered", async () => {
    const root = createRoot();
    const load = () => Promise.resolve("data");

    function App() {
      const user = load();
      return <p>{user}</p>;
    }

    expect(() => mount(() => <App />, root)).toThrow(/useResource/);
  });

  it("warn when a const holding one depends on state", async () => {
    const root = createRoot();
    const load = (id: number) => Promise.resolve(id);

    function App() {
      let id = 1;
      const user = load(id);
      return <p>{void user}</p>;
    }

    mount(() => <App />, root);
    const warnings = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(warnings.some((text: string) => text.includes("useResource()"))).toBe(true);
  });

  it("do not warn when a const holding one reads no state", async () => {
    const root = createRoot();
    const load = () => Promise.resolve(1);

    function App() {
      const ready = load();
      return <p>{void ready}</p>;
    }

    mount(() => <App />, root);
    expect(warn).not.toHaveBeenCalled();
  });
});
