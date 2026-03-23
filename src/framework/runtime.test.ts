import { beforeEach, describe, expect, it } from "vitest";
import { cell, dynAttr, dynBlock, dynText, frag, get, h, hydrate, list, mount, node, set } from "./runtime";
import {
  dynBlock as serverDynBlock,
  dynText as serverDynText,
  h as serverH,
  list as serverList,
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

  it("keeps textarea value in sync as a controlled property", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const text = cell("alpha");
    mount(() => h("textarea", { value: dynAttr(() => get(text)) }), root);

    const textarea = root.querySelector("textarea");
    expect(textarea?.value).toBe("alpha");

    set(text, "beta");
    await flushMicrotask();

    expect(textarea?.value).toBe("beta");

    set(text, "");
    await flushMicrotask();

    expect(textarea?.value).toBe("");
  });

  it("keeps text input value in sync as a controlled property", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const text = cell("alpha");
    mount(() => h("input", { type: "text", value: dynAttr(() => get(text)) }), root);

    const input = root.querySelector("input");
    expect(input?.value).toBe("alpha");

    set(text, "beta");
    await flushMicrotask();

    expect(input?.value).toBe("beta");

    set(text, "");
    await flushMicrotask();

    expect(input?.value).toBe("");
  });

  it("keeps select value in sync as a controlled property", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const mode = cell("b");
    mount(
      () =>
        h(
          "select",
          { value: dynAttr(() => get(mode)) },
          h("option", { value: "a" }, "Alpha"),
          h("option", { value: "b" }, "Beta"),
          h("option", { value: "c" }, "Gamma"),
        ),
      root,
    );

    const select = root.querySelector("select");
    expect(select?.value).toBe("b");

    set(mode, "c");
    await flushMicrotask();

    expect(select?.value).toBe("c");
  });

  it("keeps radio checked state in sync as a controlled property", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const selected = cell("b");
    mount(
      () =>
        h(
          "div",
          null,
          h("input", {
            type: "radio",
            name: "mode",
            value: "a",
            checked: dynAttr(() => get(selected) === "a"),
          }),
          h("input", {
            type: "radio",
            name: "mode",
            value: "b",
            checked: dynAttr(() => get(selected) === "b"),
          }),
        ),
      root,
    );

    const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios[0]?.checked).toBe(false);
    expect(radios[1]?.checked).toBe(true);

    set(selected, "a");
    await flushMicrotask();

    expect(radios[0]?.checked).toBe(true);
    expect(radios[1]?.checked).toBe(false);
  });

  it("keeps checkbox checked state in sync as a controlled property", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const checked = cell(true);
    mount(() => h("input", { type: "checkbox", checked: dynAttr(() => get(checked)) }), root);

    const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);

    set(checked, false);
    await flushMicrotask();

    expect(checkbox?.checked).toBe(false);
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

  it("patches mismatched hydrated form properties immediately", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div>
        <textarea>wrong</textarea>
        <select><option value="a">Alpha</option><option value="b" selected="">Beta</option></select>
        <input type="radio" name="mode" value="a">
        <input type="radio" name="mode" value="b" checked="">
      </div>
    `;
    document.body.appendChild(root);

    hydrate(
      () =>
        h(
          "div",
          null,
          h("textarea", { value: dynAttr(() => "right") }),
          h(
            "select",
            { value: dynAttr(() => "a") },
            h("option", { value: "a" }, "Alpha"),
            h("option", { value: "b" }, "Beta"),
          ),
          h("input", { type: "radio", name: "mode", value: "a", checked: dynAttr(() => true) }),
          h("input", { type: "radio", name: "mode", value: "b", checked: dynAttr(() => false) }),
        ),
      root,
    );

    const textarea = root.querySelector("textarea");
    const select = root.querySelector("select");
    const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');

    expect(textarea?.value).toBe("right");
    expect(select?.value).toBe("a");
    expect(radios[0]?.checked).toBe(true);
    expect(radios[1]?.checked).toBe(false);
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

  it("renders mapped array children and refreshes the list on updates", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const count = cell(2);
    const items = () => Array.from({ length: get(count) }, (_, index) => h("li", null, `Row ${index + 1}`));

    mount(() => h("ul", null, dynBlock(() => items())), root);

    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.textContent).toContain("Row 2");

    set(count, 4);
    await flushMicrotask();

    const rows = root.querySelectorAll("li");
    expect(rows).toHaveLength(4);
    expect(Array.from(rows, (entry) => entry.textContent)).toEqual(["Row 1", "Row 2", "Row 3", "Row 4"]);
  });

  it("hydrates prerendered mapped lists and updates them after state changes", async () => {
    const root = document.createElement("div");
    const count = cell(2);

    root.innerHTML = renderToString(() =>
      serverH(
        "ul",
        null,
        serverDynBlock(() =>
          Array.from({ length: 2 }, (_, index) =>
            serverH("li", null, `Row `, serverDynText(() => index + 1)),
          ),
        ),
      ),
    );
    document.body.appendChild(root);

    const items = () => Array.from({ length: get(count) }, (_, index) => h("li", null, `Row ${index + 1}`));

    hydrate(() => h("ul", null, dynBlock(() => items())), root);

    let rows = root.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(Array.from(rows, (entry) => entry.textContent)).toEqual(["Row 1", "Row 2"]);

    set(count, 4);
    await flushMicrotask();

    rows = root.querySelectorAll("li");
    expect(rows).toHaveLength(4);
    expect(Array.from(rows, (entry) => entry.textContent)).toEqual(["Row 1", "Row 2", "Row 3", "Row 4"]);
  });

  it("reuses keyed list nodes when entries reorder", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const items = cell([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);

    mount(
      () =>
        h(
          "ul",
          null,
          list(
            () => get(items),
            (item) => item.id,
            (item) => h("li", { "data-id": item.id }, item.label),
          ),
        ),
      root,
    );

    const before = Array.from(root.querySelectorAll("li"));
    expect(before.map((entry) => entry.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);

    set(items, [get(items)[2], get(items)[0], get(items)[1]]);
    await flushMicrotask();

    const after = Array.from(root.querySelectorAll("li"));
    expect(after.map((entry) => entry.textContent)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(after[0]).toBe(before[2]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
  });

  it("hydrates keyed lists from prerendered html and reorders them by key", async () => {
    const root = document.createElement("div");
    const items = cell([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);

    root.innerHTML = renderToString(() =>
      serverH(
        "ul",
        null,
        serverList(
          () => [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
            { id: "c", label: "Gamma" },
          ],
          (item) => item.id,
          (item) => serverH("li", { "data-id": item.id }, item.label),
        ),
      ),
    );
    document.body.appendChild(root);

    hydrate(
      () =>
        h(
          "ul",
          null,
          list(
            () => get(items),
            (item) => item.id,
            (item) => h("li", { "data-id": item.id }, item.label),
          ),
        ),
      root,
    );

    const before = Array.from(root.querySelectorAll("li"));
    expect(before.map((entry) => entry.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);

    set(items, [get(items)[2], get(items)[0], get(items)[1]]);
    await flushMicrotask();

    const after = Array.from(root.querySelectorAll("li"));
    expect(after.map((entry) => entry.textContent)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(after[0]).toBe(before[2]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
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

  it("hydrates function components with multiple roots without remounting them", () => {
    const root = document.createElement("div");

    function Pair(props: Record<string, unknown>) {
      return frag(
        h("span", { class: "left" }, "left"),
        h("span", { class: "right" }, props.count),
      );
    }

    root.innerHTML = '<div><span class="left">left</span><span class="right">0</span></div>';
    document.body.appendChild(root);

    hydrate(() => h("div", null, node(() => h(Pair, { count: 0 }))), root);

    const spansBefore = root.querySelectorAll("span");
    expect(spansBefore).toHaveLength(2);
    expect(spansBefore[0]?.textContent).toBe("left");
    expect(spansBefore[1]?.textContent).toBe("0");

    const spansAfter = root.querySelectorAll("span");
    expect(spansAfter).toHaveLength(2);
    expect(spansAfter[0]).toBe(spansBefore[0]);
    expect(spansAfter[1]).toBe(spansBefore[1]);
  });

  it("rerenders function components when reactive props change", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const count = cell(0);

    function Pair(props: Record<string, unknown>) {
      return frag(
        h("span", { class: "left" }, "left"),
        h("span", { class: "right" }, props.count),
      );
    }

    mount(() => h("div", null, node(() => h(Pair, { count: dynAttr(() => get(count)) }))), root);

    let spans = root.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[1]?.textContent).toBe("0");

    set(count, 2);
    await flushMicrotask();

    spans = root.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[1]?.textContent).toBe("2");
  });

  it("hydrates a fragment root without replacing the existing dom", async () => {
    const root = document.createElement("div");
    const count = cell(0);

    root.innerHTML = '<span class="left">left</span><span class="right">0</span>';
    document.body.appendChild(root);

    hydrate(
      () =>
        frag(
          h("span", { class: "left" }, "left"),
          h("span", { class: "right" }, dynText(() => get(count))),
        ),
      root,
    );

    const spansBefore = root.querySelectorAll("span");
    expect(spansBefore).toHaveLength(2);
    expect(spansBefore[0]?.textContent).toBe("left");
    expect(spansBefore[1]?.textContent).toBe("0");

    set(count, 3);
    await flushMicrotask();

    const spansAfter = root.querySelectorAll("span");
    expect(spansAfter).toHaveLength(2);
    expect(spansAfter[0]).toBe(spansBefore[0]);
    expect(spansAfter[1]).toBe(spansBefore[1]);
    expect(spansAfter[1]?.textContent).toBe("3");
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
    expect(root.querySelector("p")?.textContent).toBe("Value: 1");
  });
});
