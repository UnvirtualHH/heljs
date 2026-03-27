import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "hel/runtime";

describe("magic component reactivity", () => {
  const flushMicrotask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps derived const values reactive without an explicit computed helper", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    function Counter() {
      let count = 0;
      const label = count % 2 === 0 ? "even" : "odd";

      return (
        <section>
          <p>{label}</p>
          <button onClick={() => count++}>+</button>
        </section>
      );
    }

    mount(() => <Counter />, root);

    expect(root.querySelector("p")?.textContent).toBe("even");

    root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flushMicrotask();

    expect(root.querySelector("p")?.textContent).toBe("odd");
  });

  it("keeps body-level prop destructuring reactive across component boundaries", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    function Child(props: { value: string }) {
      const { value } = props;
      return <p>{value}</p>;
    }

    function App() {
      let value = "alpha";

      return (
        <section>
          <Child value={value} />
          <button onClick={() => (value = "beta")}>swap</button>
        </section>
      );
    }

    mount(() => <App />, root);

    expect(root.querySelector("p")?.textContent).toBe("alpha");

    root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flushMicrotask();

    expect(root.querySelector("p")?.textContent).toBe("beta");
  });

  it("keeps parameter prop destructuring reactive across component boundaries", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    function Child({ value }: { value: string }) {
      return <p>{value}</p>;
    }

    function App() {
      let value = "alpha";

      return (
        <section>
          <Child value={value} />
          <button onClick={() => (value = "gamma")}>swap</button>
        </section>
      );
    }

    mount(() => <App />, root);

    expect(root.querySelector("p")?.textContent).toBe("alpha");

    root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flushMicrotask();

    expect(root.querySelector("p")?.textContent).toBe("gamma");
  });

  it("keeps destructured children usable through wrapper helper functions", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    function Panel(props: { children?: unknown }) {
      const { children } = props;

      function content() {
        return children;
      }

      return <section>{content()}</section>;
    }

    function App() {
      let label = "alpha";

      return (
        <main>
          <Panel>
            <p>{label}</p>
          </Panel>
          <button onClick={() => (label = "delta")}>swap</button>
        </main>
      );
    }

    mount(() => <App />, root);

    expect(root.querySelector("p")?.textContent).toBe("alpha");

    root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flushMicrotask();

    expect(root.querySelector("p")?.textContent).toBe("delta");
  });

  it("keeps nested prop destructuring and aliases reactive across component boundaries", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    function Child(props: { todo: { title?: string }; meta: { level: string } }) {
      const { todo: { title = "fallback" }, meta: info } = props;
      return <p>{title} / {info.level}</p>;
    }

    function App() {
      let title = "alpha";
      let level = "L1";

      return (
        <section>
          <Child todo={{ title }} meta={{ level }} />
          <button onClick={() => {
            title = "omega";
            level = "L2";
          }}>swap</button>
        </section>
      );
    }

    mount(() => <App />, root);

    expect(root.querySelector("p")?.textContent).toBe("alpha / L1");

    root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flushMicrotask();

    expect(root.querySelector("p")?.textContent).toBe("omega / L2");
  });
});
