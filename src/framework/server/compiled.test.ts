import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { helMagicPlugin } from "../compiler/plugin";
import * as clientRuntime from "../runtime/index";
import * as serverRuntime from "./index";

function transform(code: string): string {
  const plugin = helMagicPlugin() as unknown as {
    transform: (code: string, id: string) => { code: string };
  };
  return plugin.transform(code, "Component.tsx").code;
}

// Compiles one source against either runtime, so server output and hydration
// exercise the same compiled component.
function compile(source: string, runtime: object, name: string): (props: object) => unknown {
  const body = transform(source).replace(
    /import \{([^}]*)\} from "hel\/runtime";/,
    (_, names: string) => `const {${names.replaceAll(" as ", ": ")}} = __runtime;`,
  );
  return new Function("__runtime", `${body}\nreturn ${name};`)(runtime);
}

function renderOnServer(source: string, name = "App"): string {
  const App = compile(source, serverRuntime, name);
  return serverRuntime.renderToString(() => serverRuntime.h(App, null));
}

function hydrateFromServer(source: string, name = "App"): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderOnServer(source, name);
  document.body.appendChild(root);
  const App = compile(source, clientRuntime, name);
  clientRuntime.hydrate(() => clientRuntime.h(App, null), root);
  return root;
}

const flush = async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const click = (element: Element | null | undefined) =>
  element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = "";
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("compiled server output", () => {
  it("computes a derived const only once while rendering", () => {
    const calls = { value: 0 };
    const source = `
      function App() {
        let count = 1;
        const doubled = (__calls.value++, count * 2);
        return <p>{doubled}|{doubled}</p>;
      }
    `;
    const App = new Function(
      "__calls",
      "__runtime",
      `${transform(source).replace(/import \{([^}]*)\} from "hel\/runtime";/, (_, names: string) => `const {${names.replaceAll(" as ", ": ")}} = __runtime;`)}\nreturn App;`,
    )(calls, serverRuntime);

    const html = serverRuntime.renderToString(() => serverRuntime.h(App, null));

    expect(html).toContain("2|2");
    expect(calls.value).toBe(1);
  });

  it("renders hook results and derived values", () => {
    const html = renderOnServer(`
      function useCounter() {
        let count = 3;
        const doubled = count * 2;
        return { count, doubled };
      }
      function App() {
        const { count, doubled } = useCounter();
        return <p>{count}|{doubled}</p>;
      }
    `);

    expect(html).toContain("3|6");
  });

  it("renders the value of a reactive prop read as props.x", () => {
    const html = renderOnServer(`
      function Card(props) { return <h2>{props.title}</h2>; }
      function App() { let n = 7; return <section><Card title={n} /></section>; }
    `);

    expect(html).toContain("<h2>7</h2>");
  });

  it("renders the value of a reactive prop read through destructuring", () => {
    const html = renderOnServer(`
      function Card(props) { const { title } = props; return <h2>{title}</h2>; }
      function App() { let n = 7; return <section><Card title={n} /></section>; }
    `);

    expect(html).toContain("<h2>7</h2>");
  });

  it("gives a deep context consumer the provider value", () => {
    const html = renderOnServer(`
      import { createContext, useContext } from "hel/runtime";
      const Theme = createContext("default");
      function Consumer() { const value = useContext(Theme); return <em>{value}</em>; }
      function App() {
        return <Theme.Provider value="provided"><div><Consumer /></div></Theme.Provider>;
      }
    `);

    expect(html).toContain("<em>provided</em>");
  });

  it("renders JSX passed through props.children", () => {
    const html = renderOnServer(`
      function Box(props) { return <div>{props.children}</div>; }
      function App() { return <Box><b>hi</b></Box>; }
    `);

    expect(html).toContain("<b>hi</b>");
    expect(html).not.toContain("[object");
  });

  it("does not render an unused JSX fallback", () => {
    const html = renderOnServer(`
      import { Show } from "hel/runtime";
      function App() { return <main><Show when={true} fallback={<u>hidden</u>}><b>shown</b></Show></main>; }
    `);

    expect(html).toContain("<b>shown</b>");
    expect(html).not.toContain("hidden");
  });
});

describe("compiled hydration", () => {
  it("attaches row handlers of a compiled keyed list", async () => {
    const root = hydrateFromServer(`
      import { list } from "hel/runtime";
      function App() {
        let items = [{ id: "a" }, { id: "b" }];
        let picked = "";
        return (
          <div>
            <i>{picked}</i>
            <ul>{list(() => items, (item) => item.id, (item) => <li onClick={() => (picked = item.id)}>{item.id}</li>)}</ul>
          </div>
        );
      }
    `);

    click(root.querySelectorAll("li")[1]);
    await flush();

    expect(root.querySelector("i")?.textContent).toBe("b");
  });

  it("keeps the prerendered rows of a compiled keyed list", () => {
    const source = `
      import { list } from "hel/runtime";
      function App() {
        let items = [{ id: "a" }];
        return <ul>{list(() => items, (item) => item.id, (item) => <li>{item.id}</li>)}</ul>;
      }
    `;
    const root = document.createElement("div");
    root.innerHTML = renderOnServer(source);
    document.body.appendChild(root);
    const row = root.querySelector("li");

    clientRuntime.hydrate(() => clientRuntime.h(compile(source, clientRuntime, "App"), null), root);

    expect(root.querySelector("li")).toBe(row);
    expect(root.querySelectorAll("li").length).toBe(1);
  });

  it("hydrates a keyed list nested directly inside a block", () => {
    const root = document.createElement("div");
    const items = [{ id: "a" }, { id: "b" }];
    const server = serverRuntime;
    const client = clientRuntime;

    root.innerHTML = server.renderToString(() =>
      server.h(
        "ul",
        null,
        server.dynBlock(() =>
          server.list(() => items, (item) => item.id, (item) => server.h("li", null, item.id)),
        ),
      ),
    );
    document.body.appendChild(root);
    const rows = Array.from(root.querySelectorAll("li"));

    expect(() =>
      client.hydrate(
        () =>
          client.h(
            "ul",
            null,
            client.dynBlock(() =>
              client.list(() => items, (item) => item.id, (item) => client.h("li", null, item.id)),
            ),
          ),
        root,
      ),
    ).not.toThrow();

    expect(Array.from(root.querySelectorAll("li"))).toEqual(rows);
  });

  it("hydrates nested ternaries and keeps them reactive", async () => {
    const root = hydrateFromServer(`
      function App() {
        let outer = false;
        let inner = false;
        return <div onClick={() => (inner = true)}>{outer ? <i>A</i> : inner ? <i>B</i> : <i>C</i>}</div>;
      }
    `);

    expect(warn).not.toHaveBeenCalled();
    expect(root.textContent).toBe("C");

    click(root.querySelector("div"));
    await flush();

    expect(root.textContent).toBe("B");
  });

  it("hydrates Show and For without mismatch warnings and stays reactive", async () => {
    const root = hydrateFromServer(`
      import { For, Show } from "hel/runtime";
      function App() {
        let visible = true;
        let items = ["a", "b"];
        return (
          <div onClick={() => { visible = !visible; items = [...items, "c"]; }}>
            <Show when={visible} fallback={<u>hidden</u>}><b>shown</b></Show>
            <ul><For each={items}>{(item) => <li>{item}</li>}</For></ul>
          </div>
        );
      }
    `);

    expect(warn).not.toHaveBeenCalled();

    click(root.querySelector("div"));
    await flush();

    expect(root.textContent).toContain("hidden");
    expect(root.querySelectorAll("li").length).toBe(3);
  });

  it("hydrates a keyed For with an empty list and a following sibling", () => {
    const root = hydrateFromServer(`
      import { For } from "hel/runtime";
      function App() {
        let items = [];
        return (
          <div>
            <For each={items} key={(item) => item}>{(item) => <li>{item}</li>}</For>
            <p>after</p>
          </div>
        );
      }
    `);

    expect(warn).not.toHaveBeenCalled();
    expect(root.querySelector("p")?.textContent).toBe("after");
  });

  it("hydrates JSX passed through props.children without remounting it", () => {
    const source = `
      function Box(props) { return <div>{props.children}</div>; }
      function App() { let n = 1; return <Box><b onClick={() => n++}>{n}</b></Box>; }
    `;
    const root = document.createElement("div");
    root.innerHTML = renderOnServer(source);
    document.body.appendChild(root);
    const bold = root.querySelector("b");

    clientRuntime.hydrate(() => clientRuntime.h(compile(source, clientRuntime, "App"), null), root);

    expect(warn).not.toHaveBeenCalled();
    expect(root.querySelector("b")).toBe(bold);
  });

  it("gives a later mounted consumer the provider value after hydration", async () => {
    const root = hydrateFromServer(`
      import { createContext, useContext } from "hel/runtime";
      const Theme = createContext("default");
      function Consumer() { const value = useContext(Theme); return <em>{value}</em>; }
      function Toggle() {
        let visible = false;
        return <div onClick={() => (visible = true)}>{visible ? <Consumer /> : <span>none</span>}</div>;
      }
      function App() { return <main><Theme.Provider value="provided"><Toggle /></Theme.Provider></main>; }
    `);

    click(root.querySelector("div"));
    await flush();

    expect(root.querySelector("em")?.textContent).toBe("provided");
  });

  it("hydrates a shared hook and a derived const without warnings and stays reactive", async () => {
    const root = hydrateFromServer(`
      function useCart() {
        let items = [];
        const count = items.length;
        function add() { items = [...items, 1]; }
        return { count, add };
      }
      function App() {
        const cart = useCart();
        const label = cart.count === 0 ? "empty" : "items: " + cart.count;
        const badge = <em>{label}</em>;
        return <button onClick={() => cart.add()}>{badge}</button>;
      }
    `);

    expect(warn).not.toHaveBeenCalled();
    expect(root.textContent).toBe("empty");
    const button = root.querySelector("button");

    click(button);
    await flush();

    expect(root.querySelector("button")).toBe(button);
    expect(root.textContent).toBe("items: 1");
  });

  it("does not claim prerendered nodes when a JSX const is declared early", () => {
    const source = `
      function App() {
        const late = <i>late</i>;
        return <main><b>first</b>{late}</main>;
      }
    `;
    const root = document.createElement("div");
    root.innerHTML = renderOnServer(source);
    document.body.appendChild(root);
    const first = root.querySelector("b");

    clientRuntime.hydrate(() => clientRuntime.h(compile(source, clientRuntime, "App"), null), root);

    expect(warn).not.toHaveBeenCalled();
    expect(root.querySelector("b")).toBe(first);
  });

  it("disposes a hidden ternary branch after hydration", async () => {
    const root = hydrateFromServer(`
      function App() {
        let show = true;
        return <div onClick={() => (show = !show)}>{show ? <b>{"on"}</b> : <i>off</i>}</div>;
      }
    `);
    const bold = root.querySelector("b");

    click(root.querySelector("div"));
    await flush();
    click(root.querySelector("div"));
    await flush();

    expect(root.querySelector("b")).not.toBe(bold);
    expect(root.textContent).toBe("on");
  });

  // Still open: the server merges adjacent text, so the client finds one text
  // node where it expects two. The result is correct, but it warns and rewrites.
  it.fails("hydrates text around a dynamic value without a mismatch warning", () => {
    hydrateFromServer(`
      function App() { let count = 0; return <button onClick={() => count++}>Count: {count}</button>; }
    `);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ErrorBoundary across server and client", () => {
  const SOURCE = `
    import { ErrorBoundary } from "hel/runtime";
    function Thing() { return <b>{__side.boom()}</b>; }
    function App() {
      let clicks = 0;
      return <section>
        <h1>head</h1>
        <ErrorBoundary fallback={(error) => <p>caught {error.message}</p>}><Thing /></ErrorBoundary>
        <button onClick={() => { clicks += 1; }}>{clicks}</button>
      </section>;
    }
  `;
  const fine = "boom: () => 'ok'";
  const failing = "boom: () => { throw new Error('nope'); }";

  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  function run(onServerSide: string, onClientSide: string): { root: HTMLElement; html: string; head: Element | null } {
    const root = document.createElement("div");
    const onServer = compile(`const __side = { ${onServerSide} };${SOURCE}`, serverRuntime, "App");
    const html = serverRuntime.renderToString(() => serverRuntime.h(onServer, null));
    root.innerHTML = html;
    document.body.appendChild(root);
    const head = root.querySelector("h1");
    const onClient = compile(`const __side = { ${onClientSide} };${SOURCE}`, clientRuntime, "App");
    clientRuntime.hydrate(() => clientRuntime.h(onClient, null), root);
    return { root, html, head };
  }

  async function expectInteractive(root: HTMLElement, head: Element | null) {
    expect(root.querySelector("h1")).toBe(head);
    click(root.querySelector("button"));
    await flush();
    expect(root.querySelector("button")?.textContent).toBe("1");
  }

  it("claims the children when both sides are fine", async () => {
    const { root, head } = run(fine, fine);
    await flush();

    expect(root.querySelector("b")?.textContent).toBe("ok");
    expect(warn).not.toHaveBeenCalled();
    await expectInteractive(root, head);
  });

  it("replaces the server's content when only the client fails", async () => {
    const { root, head } = run(fine, failing);
    await flush();

    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("caught nope");
    expect(warn).not.toHaveBeenCalled();
    await expectInteractive(root, head);
  });

  it("shows the fallback without a false warning when both fail", async () => {
    const { root, html, head } = run(failing, failing);
    expect(html).toContain("<p>caught nope</p>");
    expect(consoleError).toHaveBeenCalled();

    await flush();

    expect(root.querySelector("p")?.textContent).toBe("caught nope");
    expect(warn).not.toHaveBeenCalled();
    await expectInteractive(root, head);
  });

  it("renders the children when only the server failed", async () => {
    const { root, head } = run(failing, fine);
    await flush();

    expect(root.querySelector("p")).toBeNull();
    expect(root.querySelector("b")?.textContent).toBe("ok");
    expect(warn).not.toHaveBeenCalled();
    await expectInteractive(root, head);
  });

  it("restores the context after a failure on the server", () => {
    const html = renderOnServer(`
      import { createContext, ErrorBoundary, useContext } from "hel/runtime";
      const Theme = createContext("default");
      function Bad() { throw new Error("nope"); }
      function Nested() { return <Theme.Provider value="inner"><Bad /></Theme.Provider>; }
      function Reader() { return <em>{useContext(Theme)}</em>; }
      function App() {
        return <Theme.Provider value="outer"><ErrorBoundary fallback={<p>caught</p>}><Nested /></ErrorBoundary><Reader /></Theme.Provider>;
      }
    `);

    expect(html).toContain("<em>outer</em>");
    expect(html).toContain("<p>caught</p>");
  });
});

describe("useResource across server and client", () => {
  const source = (options = "") => `
    import { useResource } from "hel/runtime";
    function App() {
      let clicks = 0;
      const pet = useResource(() => "/pets/1", __load.fetcher${options});
      return <div>{pet.loading ? <i>loading</i> : <b>{pet.value}</b>}<button onClick={() => { clicks += 1; }}>{clicks}</button></div>;
    }
  `;

  function run(code: string, fetcher: (url: string) => Promise<string>) {
    const build = (runtime: object) => {
      const body = transform(code).replace(
        /import \{([^}]*)\} from "hel\/runtime";/,
        (_, names: string) => `const {${names.replaceAll(" as ", ": ")}} = __runtime;`,
      );
      return new Function("__runtime", "__load", `${body}\nreturn App;`)(runtime, { fetcher });
    };

    const root = document.createElement("div");
    root.innerHTML = serverRuntime.renderToString(() => serverRuntime.h(build(serverRuntime), null));
    document.body.appendChild(root);
    const html = root.innerHTML;
    const button = root.querySelector("button");
    clientRuntime.hydrate(() => clientRuntime.h(build(clientRuntime), null), root);
    return { root, html, button };
  }

  it("never fetches on the server and fetches once after hydration", async () => {
    const urls: string[] = [];
    const { root, html, button } = run(source(), async (url) => {
      urls.push(url);
      return "data";
    });

    expect(html).toContain("<i>loading</i>");
    expect(urls).toEqual(["/pets/1"]);
    expect(warn).not.toHaveBeenCalled();
    expect(root.querySelector("button")).toBe(button);

    await flush();
    expect(root.querySelector("b")?.textContent).toBe("data");

    click(button);
    await flush();
    expect(button?.textContent).toBe("1");
  });

  it("renders initial on the server and does not fetch at all", async () => {
    const urls: string[] = [];
    const { root, html } = run(source(`, { initial: "preloaded" }`), async (url) => {
      urls.push(url);
      return "data";
    });

    expect(html).toContain("<b>preloaded</b>");
    await flush();

    expect(urls).toEqual([]);
    expect(root.querySelector("b")?.textContent).toBe("preloaded");
    expect(warn).not.toHaveBeenCalled();
  });

  it("fetches after hydration when the source changes", async () => {
    const urls: string[] = [];
    const code = `
      import { useResource } from "hel/runtime";
      function App() {
        let id = 1;
        const pet = useResource(() => "/pets/" + id, __load.fetcher, { initial: "preloaded" });
        return <button onClick={() => { id += 1; }}>{pet.loading ? "loading" : pet.value}</button>;
      }
    `;
    const { root } = run(code, async (url) => {
      urls.push(url);
      return "data";
    });

    expect(root.textContent).toBe("preloaded");
    click(root.querySelector("button"));
    await flush();

    expect(urls).toEqual(["/pets/2"]);
    expect(root.textContent).toBe("data");
  });
});

describe("serializeData", () => {
  it("cannot break out of a script element", () => {
    const value = { name: "</script><script>alert(1)</script>", amp: "a&b", line: `x${String.fromCharCode(0x2028)}y` };
    const text = serverRuntime.serializeData(value);

    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).not.toContain("&");
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(text)).toEqual(value);
  });

  it("handles undefined", () => {
    expect(serverRuntime.serializeData(undefined)).toBe("undefined");
  });
});

describe("promises on the server", () => {
  it("cannot be rendered", () => {
    expect(() =>
      renderOnServer(`
        const load = () => Promise.resolve("data");
        function App() { const user = load(); return <p>{user}</p>; }
      `),
    ).toThrow(/useResource/);
  });
});

describe("hydration keeps content in place", () => {
  // The same source renders differently depending on the side it runs on.
  function hydrateDifferently(source: string): HTMLElement {
    const root = document.createElement("div");
    const onServer = compile(`const __side = { server: true };${source}`, serverRuntime, "App");
    root.innerHTML = serverRuntime.renderToString(() => serverRuntime.h(onServer, null));
    document.body.appendChild(root);
    const onClient = compile(`const __side = { server: false };${source}`, clientRuntime, "App");
    clientRuntime.hydrate(() => clientRuntime.h(onClient, null), root);
    return root;
  }

  it("claims the page of a route", async () => {
    const source = `
      import { createRouter } from "hel/runtime";
      function Page() {
        let clicks = 0;
        return <section><a href={"/pets/" + clicks}>link</a><button onClick={() => { clicks += 1; }}>{clicks}</button></section>;
      }
      function App() {
        const router = createRouter([{ path: "/", view: () => <Page /> }], { initialPath: "/" });
        return <main>{router.view()}<footer>foot</footer></main>;
      }
    `;
    const root = document.createElement("div");
    root.innerHTML = renderOnServer(source);
    document.body.appendChild(root);
    const section = root.querySelector("section");
    const button = root.querySelector("button");

    clientRuntime.hydrate(() => clientRuntime.h(compile(source, clientRuntime, "App"), null), root);

    expect(warn).not.toHaveBeenCalled();
    expect(root.querySelector("section")).toBe(section);
    expect(root.querySelector("button")).toBe(button);

    click(button);
    await flush();
    expect(button?.textContent).toBe("1");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("/pets/1");
  });

  it("keeps a provider's content when a sibling follows", async () => {
    const root = hydrateFromServer(`
      import { createContext, useContext } from "hel/runtime";
      const Theme = createContext("default");
      function Inner() { return <b>{useContext(Theme)}</b>; }
      function App() {
        let clicks = 0;
        return <section><Theme.Provider value="provided"><Inner /><i>{clicks}</i></Theme.Provider><footer onClick={() => { clicks += 1; }}>f</footer></section>;
      }
    `);

    expect(root.innerHTML).toBe("<section><b>provided</b><i>0</i><footer>f</footer></section>");
    expect(warn).not.toHaveBeenCalled();

    click(root.querySelector("footer"));
    await flush();
    expect(root.querySelector("i")?.textContent).toBe("1");
  });

  it("claims a slot directly inside a provider", async () => {
    const source = `
      import { createContext } from "hel/runtime";
      const Theme = createContext("default");
      function App() {
        let clicks = 0;
        return <section><Theme.Provider value="provided">{clicks}</Theme.Provider><button onClick={() => { clicks += 1; }}>go</button></section>;
      }
    `;
    const root = hydrateFromServer(source);
    const button = root.querySelector("button");

    expect(warn).not.toHaveBeenCalled();
    click(button);
    await flush();
    expect(root.querySelector("button")).toBe(button);
    expect(root.querySelector("section")?.textContent).toBe("1go");
  });

  it("claims the content of a fragment when a sibling follows", async () => {
    const root = hydrateFromServer(`
      function App() {
        let clicks = 0;
        return <section><><i>{clicks}</i>{clicks > 0 ? <b>more</b> : <u>none</u>}</><button onClick={() => { clicks += 1; }}>go</button></section>;
      }
    `);
    const italic = root.querySelector("i");
    const button = root.querySelector("button");

    expect(warn).not.toHaveBeenCalled();
    click(button);
    await flush();
    expect(root.querySelector("i")).toBe(italic);
    expect(root.querySelector("i")?.textContent).toBe("1");
    expect(root.querySelector("b")?.textContent).toBe("more");
    expect(root.querySelector("u")).toBeNull();
    expect(root.querySelector("button")).toBe(button);
  });

  it("shows the client's content after a mismatch in a branch", () => {
    const root = hydrateDifferently(`
      function App() { return <section>{__side.server ? <p>server</p> : <b>client</b>}<button>go</button></section>; }
    `);

    expect(warn).toHaveBeenCalled();
    expect(root.querySelector("section")?.textContent).toBe("clientgo");
    expect(root.querySelector("p")).toBeNull();
    expect(root.querySelector("b + button, b ~ button")).not.toBeNull();
  });

  it("keeps the position of text after a mismatch in a block", () => {
    const root = hydrateDifferently(`
      function App() { return <section>{__side.server ? <p>server</p> : "client"}<button>go</button></section>; }
    `);

    expect(root.querySelector("section")?.textContent).toBe("clientgo");
  });
});
