import { beforeEach, describe, expect, it } from "vitest";
import { cell, dynAttr, dynBlock, dynText, frag, get, h, hydrate, mount, node, set } from "./runtime";
import {
  dynBlock as serverDynBlock,
  dynText as serverDynText,
  h as serverH,
  node as serverNode,
  renderToString,
} from "./server";

describe("runtime", () => {
  const flushMicrotask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("updates text slots after state changes", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const count = cell(0);
    mount(() => h("p", null, dynText(() => get(count))), root);

    expect(root.textContent).toBe("0");

    set(count, 2);
    await flushMicrotask();

    expect(root.textContent).toBe("2");
  });

  it("patches mismatched hydrated attributes immediately", () => {
    const root = document.createElement("div");
    root.innerHTML = '<button disabled="">Reset</button>';
    document.body.appendChild(root);

    const enabled = cell(false);
    hydrate(() => h("button", { disabled: dynAttr(() => get(enabled)) }, "Reset"), root);

    const button = root.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("disabled")).toBe(false);
  });

  it("updates block slots without replacing the surrounding tree", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const visible = cell(true);
    mount(
      () =>
        h("section", null, h("h1", null, "Stable"), dynBlock(() => (get(visible) ? h("p", null, "Open") : h("p", null, "Closed")))),
      root,
    );

    const stable = root.querySelector("h1");
    expect(root.textContent).toContain("Open");

    set(visible, false);
    await flushMicrotask();

    expect(root.textContent).toContain("Closed");
    expect(root.querySelector("h1")).toBe(stable);
  });

  it("cleans up removed nodes when a block slot switches branches", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const visible = cell(true);
    mount(
      () =>
        h("section", null, dynBlock(() => (get(visible) ? h("div", { class: "open" }, "Alpha") : h("div", { class: "closed" }, "Beta")))),
      root,
    );

    expect(root.querySelector(".open")?.textContent).toBe("Alpha");

    set(visible, false);
    await flushMicrotask();

    expect(root.querySelector(".open")).toBeNull();
    expect(root.querySelector(".closed")?.textContent).toBe("Beta");
  });

  it("falls back to a local remount when hydrated child structure mismatches", () => {
    const root = document.createElement("div");
    root.innerHTML = "<main><span>wrong</span><p>keep</p></main>";
    document.body.appendChild(root);

    hydrate(
      () =>
        h(
          "main",
          null,
          node(() => h("h1", null, "Title")),
          node(() => h("p", null, "keep")),
        ),
      root,
    );

    expect(root.querySelector("span")).toBeNull();
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelector("p")?.textContent).toBe("keep");
  });

  it("mounts function components with multiple roots", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    function Pair() {
      return frag(h("span", null, "left"), h("span", null, "right"));
    }

    mount(() => h("div", null, h(Pair, null)), root);

    const spans = root.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(Array.from(spans, (entry) => entry.textContent)).toEqual(["left", "right"]);
  });

  it("hydrates prerendered html and keeps events working", async () => {
    const root = document.createElement("div");
    const count = cell(0);

    root.innerHTML = renderToString(() =>
      serverH(
        "main",
        null,
        serverNode(() => serverH("button", null, "Increment")),
        serverDynBlock(() => serverH("p", null, "Value: ", serverDynText(() => 0))),
      ),
    );
    document.body.appendChild(root);

    hydrate(
      () =>
        h(
          "main",
          null,
          node(() => h("button", { onClick: () => set(count, get(count) + 1) }, "Increment")),
          dynBlock(() => h("p", null, "Value: ", dynText(() => get(count)))),
        ),
      root,
    );

    const button = root.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Increment");

    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(get(count)).toBe(1);
    await flushMicrotask();

    expect(button?.textContent).toBe("Increment");
    expect(root.querySelector("p")?.textContent).toBe("Value: 0");
  });
});
