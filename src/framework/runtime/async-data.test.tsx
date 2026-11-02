import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createRouter, effect, ErrorBoundary, h, list, mount, onCleanup, onMount, useContext, useResource } from "hel/runtime";

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const flush = async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await wait();
};

const createRoot = () => {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
};

const reported: unknown[] = [];
const messages = () => reported.map((error) => (error as Error).message);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  reported.length = 0;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

// A request that settles when the test says so.
function createApi<T = string>() {
  const requests: Array<{
    source: string;
    signal: AbortSignal;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  }> = [];

  const fetcher = (source: string, signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      requests.push({ source, signal, resolve, reject });
    });

  return { fetcher, requests };
}

describe("useResource", () => {
  function setup() {
    const root = createRoot();
    const api = createApi();
    const controls: {
      id?: (value: number) => void;
      hide?: () => void;
      pet?: ReturnType<typeof useResource<string, string>>;
    } = {};

    function Pet(props: { id: number }) {
      const pet = useResource(() => (props.id === 0 ? "" : `/pets/${props.id}`), api.fetcher);
      controls.pet = pet;
      return <p>{pet.loading ? "loading" : pet.error ? "failed" : pet.value ?? "idle"}</p>;
    }

    function App() {
      let id = 1;
      let visible = true;
      controls.id = (value) => {
        id = value;
      };
      controls.hide = () => {
        visible = false;
      };
      return <main>{visible && <Pet id={id} />}</main>;
    }

    mount(() => <App />, root);
    return { root, api, controls };
  }

  it("starts loading, then shows the value", async () => {
    const { root, api } = setup();

    expect(root.textContent).toBe("loading");
    expect(api.requests.map((request) => request.source)).toEqual(["/pets/1"]);

    api.requests[0]!.resolve("first");
    await flush();

    expect(root.textContent).toBe("first");
  });

  it("refetches when the source changes and clears the old value", async () => {
    const { root, api, controls } = setup();

    api.requests[0]!.resolve("first");
    await flush();
    controls.id!(2);
    await flush();

    expect(root.textContent).toBe("loading");
    expect(controls.pet!.value).toBeUndefined();
    expect(api.requests.map((request) => request.source)).toEqual(["/pets/1", "/pets/2"]);
  });

  it("ignores and aborts a request that a newer source replaced", async () => {
    const { root, api, controls } = setup();

    controls.id!(2);
    await flush();
    expect(api.requests[0]!.signal.aborted).toBe(true);

    api.requests[1]!.resolve("second");
    await flush();
    api.requests[0]!.resolve("first, but late");
    await flush();

    expect(root.textContent).toBe("second");
  });

  it("does not refetch when the source keeps its value", async () => {
    const root = createRoot();
    const api = createApi<number>();
    const controls: { pet?: (value: { id: number; name: string }) => void } = {};

    function App() {
      let pet = { id: 1, name: "a" };
      controls.pet = (value) => {
        pet = value;
      };
      const details = useResource(() => `/pets/${pet.id}`, api.fetcher);
      return <p>{details.value}</p>;
    }

    mount(() => <App />, root);
    controls.pet!({ id: 1, name: "b" });
    await flush();

    expect(api.requests).toHaveLength(1);
  });

  it("does not fetch for a falsy source, and clears the value", async () => {
    const { root, api, controls } = setup();

    api.requests[0]!.resolve("first");
    await flush();
    controls.id!(0);
    await flush();

    expect(root.textContent).toBe("idle");
    expect(api.requests).toHaveLength(1);
    expect(controls.pet!.loading).toBe(false);
  });

  it("reports a failure through error, and value throws", async () => {
    const { root, api, controls } = setup();
    const failure = new Error("http 500");

    api.requests[0]!.reject(failure);
    await flush();

    expect(root.textContent).toBe("failed");
    expect(controls.pet!.error).toBe(failure);
    expect(() => controls.pet!.value).toThrow(failure);
    expect(messages()).toEqual([]);
  });

  it("treats a fetcher that throws synchronously as a failure", async () => {
    const root = createRoot();

    function App() {
      const pet = useResource(
        () => "/pets/1",
        (): string => {
          throw new Error("sync");
        },
      );
      return <p>{pet.error ? "failed" : "ok"}</p>;
    }

    mount(() => <App />, root);
    await flush();

    expect(root.textContent).toBe("failed");
  });

  it("keeps the value while refetching and clears an earlier error", async () => {
    const { api, controls } = setup();

    api.requests[0]!.resolve("first");
    await flush();
    controls.pet!.refetch();
    await flush();

    expect(controls.pet!.value).toBe("first");
    expect(controls.pet!.loading).toBe(true);

    api.requests[1]!.reject(new Error("nope"));
    await flush();
    expect(controls.pet!.error).toBeDefined();

    controls.pet!.refetch();
    await flush();
    expect(controls.pet!.error).toBeUndefined();

    api.requests[2]!.resolve("third");
    await flush();
    expect(controls.pet!.value).toBe("third");
  });

  it("aborts the request when the component goes away", async () => {
    const { api, controls } = setup();

    controls.hide!();
    await flush();

    expect(api.requests[0]!.signal.aborted).toBe(true);
  });

  it("keeps the old value on a source change with keepPrevious", async () => {
    const root = createRoot();
    const api = createApi();
    const controls: { query?: (value: string) => void } = {};

    function App() {
      let query = "a";
      controls.query = (value) => {
        query = value;
      };
      const results = useResource(() => `/search?q=${query}`, api.fetcher, { keepPrevious: true });
      return <p>{results.value}{results.loading ? "…" : ""}</p>;
    }

    mount(() => <App />, root);
    api.requests[0]!.resolve("for a");
    await flush();
    controls.query!("b");
    await flush();

    expect(root.textContent).toBe("for a…");
  });

  it("starts from initial but still fetches outside hydration", async () => {
    const root = createRoot();
    const api = createApi();

    function App() {
      const pet = useResource(() => "/pets/1", api.fetcher, { initial: "preloaded" });
      return <p>{pet.value}{pet.loading ? "…" : ""}</p>;
    }

    mount(() => <App />, root);
    expect(root.textContent).toBe("preloaded…");
    expect(api.requests).toHaveLength(1);

    api.requests[0]!.resolve("fresh");
    await flush();
    expect(root.textContent).toBe("fresh");
  });

  it("does not track what the fetcher reads", async () => {
    const root = createRoot();
    const controls: { other?: (value: number) => void } = {};
    let fetches = 0;

    function App() {
      let other = 1;
      controls.other = (value) => {
        other = value;
      };
      const pet = useResource(() => "/pets/1", async () => {
        fetches += 1;
        return other;
      });
      return <p>{pet.value}</p>;
    }

    mount(() => <App />, root);
    await flush();
    controls.other!(2);
    await flush();

    expect(fetches).toBe(1);
  });

  it("stays live when destructured", async () => {
    const root = createRoot();
    const api = createApi();

    function App() {
      const { value, loading } = useResource(() => "/pets/1", api.fetcher);
      return <p>{loading ? "loading" : value}</p>;
    }

    mount(() => <App />, root);
    api.requests[0]!.resolve("first");
    await flush();

    expect(root.textContent).toBe("first");
  });
});

describe("ErrorBoundary", () => {
  function Bad(): any {
    throw new Error("bad");
  }

  it("shows the fallback when setup throws while mounting, and leaves the rest alone", async () => {
    const root = createRoot();

    mount(
      () => (
        <section>
          <h1>head</h1>
          <ErrorBoundary fallback={(error: Error) => <p>caught {error.message}</p>}>
            <div>partial</div>
            <Bad />
          </ErrorBoundary>
          <footer>foot</footer>
        </section>
      ),
      root,
    );
    await flush();

    expect(root.querySelector("h1")?.textContent).toBe("head");
    expect(root.querySelector("p")?.textContent).toBe("caught bad");
    expect(root.querySelector("div")).toBeNull();
    expect(root.querySelector("footer")?.textContent).toBe("foot");
    expect(messages()).toEqual([]);
  });

  it("accepts plain JSX as a fallback and renders it only on failure", async () => {
    const root = createRoot();
    let fallbacks = 0;

    function Oops() {
      fallbacks += 1;
      return <p>oops</p>;
    }

    mount(() => <main><ErrorBoundary fallback={<Oops />}><b>fine</b></ErrorBoundary></main>, root);
    await flush();
    expect(fallbacks).toBe(0);

    const second = createRoot();
    mount(() => <main><ErrorBoundary fallback={<Oops />}><Bad /></ErrorBoundary></main>, second);
    await flush();
    expect(second.textContent).toBe("oops");
  });

  it("catches a later toggle, and retry renders the children again", async () => {
    const root = createRoot();
    const controls: { on?: () => void; retry?: () => void } = {};
    let fail = true;

    function Maybe(): any {
      if (fail) {
        throw new Error("maybe");
      }
      return <b>fine</b>;
    }

    function Panel(props: { on: boolean }) {
      return <div>{props.on ? <Maybe /> : <i>off</i>}</div>;
    }

    function App() {
      let on = false;
      controls.on = () => {
        on = true;
      };
      return (
        <main>
          <ErrorBoundary
            fallback={(error: Error, retry: () => void) => {
              controls.retry = retry;
              return <p>caught {error.message}</p>;
            }}
          >
            <Panel on={on} />
          </ErrorBoundary>
        </main>
      );
    }

    mount(() => <App />, root);
    expect(root.textContent).toBe("off");

    controls.on!();
    await flush();
    expect(root.textContent).toBe("caught maybe");

    fail = false;
    controls.retry!();
    await flush();
    expect(root.textContent).toBe("fine");
    expect(messages()).toEqual([]);
  });

  it("disposes the children when a slot throws on a re-run", async () => {
    const root = createRoot();
    const controls: { set?: (value: number) => void } = {};
    const ran: string[] = [];
    const format = (value: number) => {
      if (value === 2) {
        throw new Error("format");
      }
      return `v${value}`;
    };

    function Inner(props: { value: number }) {
      effect(() => {
        ran.push(`effect ${props.value}`);
      });
      onCleanup(() => ran.push("cleanup"));
      return <p>{format(props.value)}</p>;
    }

    function App() {
      let value = 1;
      controls.set = (next) => {
        value = next;
      };
      return <ErrorBoundary fallback={() => <p>caught</p>}><Inner value={value} /></ErrorBoundary>;
    }

    mount(() => <App />, root);
    controls.set!(2);
    await flush();

    expect(root.textContent).toBe("caught");
    expect(ran).toContain("cleanup");

    ran.length = 0;
    controls.set!(3);
    await flush();
    expect(ran).toEqual([]);
  });

  it("catches a keyed row and an effect", async () => {
    const root = createRoot();
    const controls: { items?: (value: number[]) => void } = {};

    function Row(props: { value: number }): any {
      if (props.value === 99) {
        throw new Error("row");
      }
      return <li>{props.value}</li>;
    }

    function App() {
      let items = [1, 2];
      controls.items = (value) => {
        items = value;
      };
      return (
        <ErrorBoundary fallback={(error: Error) => <p>caught {error.message}</p>}>
          <ul>{list(() => items, (item) => item, (item) => <Row value={item} />)}</ul>
        </ErrorBoundary>
      );
    }

    mount(() => <App />, root);
    controls.items!([1, 99]);
    await flush();
    expect(root.textContent).toBe("caught row");

    function WithEffect() {
      let count = 0;
      effect(() => {
        if (count > 0) {
          throw new Error("effect");
        }
      });
      return <button onClick={() => { count += 1; }}>go</button>;
    }

    const second = createRoot();
    mount(() => <ErrorBoundary fallback={(error: Error) => <p>caught {error.message}</p>}><WithEffect /></ErrorBoundary>, second);
    second.querySelector("button")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();
    expect(second.textContent).toBe("caught effect");
  });

  it("catches a throwing onMount", async () => {
    const root = createRoot();

    function Child() {
      onMount(() => {
        throw new Error("mount");
      });
      return <i>child</i>;
    }

    mount(() => <ErrorBoundary fallback={() => <p>caught</p>}><Child /></ErrorBoundary>, root);
    await flush();
    await flush();

    expect(root.textContent).toBe("caught");
    expect(messages()).toEqual([]);
  });

  it("lets the innermost boundary win, and a throwing fallback go outward", async () => {
    const first = createRoot();
    mount(
      () => (
        <ErrorBoundary fallback={() => <p>outer</p>}>
          <ErrorBoundary fallback={() => <p>inner</p>}>
            <Bad />
          </ErrorBoundary>
        </ErrorBoundary>
      ),
      first,
    );
    await flush();
    expect(first.textContent).toBe("inner");

    const second = createRoot();
    mount(
      () => (
        <ErrorBoundary fallback={() => <p>outer</p>}>
          <ErrorBoundary
            fallback={(): any => {
              throw new Error("fallback");
            }}
          >
            <Bad />
          </ErrorBoundary>
        </ErrorBoundary>
      ),
      second,
    );
    await flush();
    expect(second.textContent).toBe("outer");
  });

  it("catches an unguarded failed resource, and retry fetches again", async () => {
    const root = createRoot();
    const controls: { retry?: () => void } = {};
    let attempts = 0;

    const load = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("http 500");
      }
      return "pet";
    };

    function Pet() {
      const pet = useResource(() => "/pet", load);
      return <b>{pet.value ?? "loading"}</b>;
    }

    mount(
      () => (
        <ErrorBoundary
          fallback={(error: Error, retry: () => void) => {
            controls.retry = retry;
            return <p>{error.message}</p>;
          }}
        >
          <Pet />
        </ErrorBoundary>
      ),
      root,
    );
    expect(root.textContent).toBe("loading");

    await flush();
    expect(root.textContent).toBe("http 500");

    controls.retry!();
    await flush();
    expect(root.textContent).toBe("pet");
    expect(attempts).toBe(2);
  });

  it("does not leave a boundary's context behind", async () => {
    const root = createRoot();
    const Theme = createContext("default");
    let seen = "";

    function Sibling() {
      seen = useContext(Theme);
      return <i>sibling</i>;
    }

    mount(
      () => (
        <Theme.Provider value="provided">
          <ErrorBoundary fallback={() => <p>caught</p>}><Bad /></ErrorBoundary>
          <Sibling />
        </Theme.Provider>
      ),
      root,
    );
    await flush();

    expect(seen).toBe("provided");
    expect(root.textContent).toBe("caughtsibling");
  });

  it("reports what it catches to the console in development", async () => {
    const root = createRoot();

    mount(() => <ErrorBoundary fallback={() => <p>caught</p>}><Bad /></ErrorBoundary>, root);
    await flush();

    expect(consoleError).toHaveBeenCalled();
  });

  it("leaves event handlers to the browser", async () => {
    const root = createRoot();
    const listener = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener("error", listener);

    mount(
      () => (
        <ErrorBoundary fallback={() => <p>caught</p>}>
          <button
            onClick={() => {
              throw new Error("handler");
            }}
          >
            go
          </button>
        </ErrorBoundary>
      ),
      root,
    );

    try {
      root.querySelector("button")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    } catch {
      // happy-dom may rethrow instead of dispatching an error event.
    }
    await flush();
    window.removeEventListener("error", listener);

    expect(root.textContent?.trim()).toBe("go");
  });
});

describe("the router and page state", () => {
  function setup() {
    let setups = 0;
    const urls: string[] = [];
    const router: ReturnType<typeof createRouter> = createRouter(
      [
        { path: "/pets/:id", view: () => <Page /> },
        { path: "/other", view: () => <h2>other</h2> },
      ],
      { initialPath: "/pets/1" },
    );

    function Page() {
      setups += 1;
      const id = router.params().id;
      const results = useResource(
        () => `/pets/${router.params().id}?q=${router.query().q ?? ""}`,
        async (url) => {
          urls.push(url);
          return url;
        },
      );
      return <section><input /><p>{id}|{router.query().q}|{results.value}</p></section>;
    }

    const root = createRoot();
    mount(() => <main>{router.view()}</main>, root);
    return { root, router, urls, setups: () => setups };
  }

  it("keeps the page on a query change", async () => {
    const { root, router, urls, setups } = setup();
    const input = root.querySelector("input");
    await flush();

    router.setQuery({ q: "cat" });
    await flush();

    expect(setups()).toBe(1);
    expect(root.querySelector("input")).toBe(input);
    expect(root.querySelector("p")?.textContent).toBe("1|cat|/pets/1?q=cat");
    expect(urls).toEqual(["/pets/1?q=", "/pets/1?q=cat"]);
  });

  it("keeps the page on a param change, and its reads stay live", async () => {
    const { root, router, setups } = setup();
    const input = root.querySelector("input");

    router.navigate("/pets/2");
    await flush();

    expect(setups()).toBe(1);
    expect(root.querySelector("input")).toBe(input);
    expect(root.querySelector("p")?.textContent).toBe("2||/pets/2?q=");
  });

  it("rebuilds the page when the route changes", async () => {
    const { root, router, setups } = setup();

    router.navigate("/other");
    await flush();
    expect(root.textContent).toBe("other");

    router.navigate("/pets/3");
    await flush();
    expect(setups()).toBe(2);
    expect(root.querySelector("p")?.textContent).toBe("3||/pets/3?q=");
  });

  it("re-renders a view that reads the router itself, and a missing route", async () => {
    const router: ReturnType<typeof createRouter> = createRouter([
      { path: "/todos", view: () => h("h2", null, `Filter ${router.query().filter ?? "all"}`) },
    ], { initialPath: "/todos" });
    const root = createRoot();
    mount(() => <main>{router.view()}</main>, root);

    router.setQuery({ filter: "done" });
    await flush();
    expect(root.textContent).toBe("Filter done");

    router.navigate("/nope");
    await flush();
    expect(root.textContent).toContain("/nope");

    router.navigate("/also-nope");
    await flush();
    expect(root.textContent).toContain("/also-nope");
  });
});
