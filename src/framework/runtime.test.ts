import { beforeEach, describe, expect, it, vi } from "vitest";
import { attr, cell, createRouter, dynAttr, dynBlock, dynText, effect, For, frag, get, getRuntimeStats, h, hydrate, list, mount, node, resetRuntimeStats, set, Show, store, text, tpl } from "./runtime";
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
    resetRuntimeStats();
  });

  it("tracks effect and subscription stats for reactive updates", async () => {
    const count = cell(0);
    const dispose = effect(() => {
      get(count);
    });

    set(count, 1);
    await flushMicrotask();

    const stats = getRuntimeStats();
    expect(stats.effectCreations).toBe(1);
    expect(stats.effectRuns).toBe(2);
    expect(stats.cellReads).toBe(2);
    expect(stats.cellWrites).toBe(1);
    expect(stats.subscriptionsTracked).toBe(2);
    expect(stats.flushCycles).toBe(1);
    expect(stats.scheduledEffects).toBe(1);

    dispose();
  });

  it("coalesces repeated schedules for the same effect within one tick", async () => {
    const count = cell(0);
    effect(() => {
      get(count);
    });

    resetRuntimeStats();
    set(count, 1);
    set(count, 2);
    set(count, 3);
    await flushMicrotask();

    const stats = getRuntimeStats();
    expect(stats.scheduledEffects).toBe(1);
    expect(stats.flushCycles).toBe(1);
    expect(stats.effectRuns).toBe(1);
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

  it("batches fresh keyed list insertions into a single live DOM insert", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const items = cell<Array<{ id: number; label: string }>>([]);
    mount(
      () =>
        h(
          "ul",
          null,
          list(
            () => get(items),
            (item) => item.id,
            (item) => h("li", null, item.label),
          ),
        ),
      root,
    );

    const listElement = root.querySelector("ul");
    expect(listElement).not.toBeNull();

    const insertBeforeSpy = vi.spyOn(listElement!, "insertBefore");

    set(
      items,
      Array.from({ length: 25 }, (_, index) => ({
        id: index,
        label: `Item ${index}`,
      })),
    );
    await flushMicrotask();

    expect(insertBeforeSpy).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll("li")).toHaveLength(25);
  });

  it("updates direct text cell bindings without the generic dynText wrapper", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const count = cell(0);
    mount(() => h("p", null, text(count)), root);

    expect(root.textContent).toBe("0");

    set(count, 4);
    await flushMicrotask();

    expect(root.textContent).toBe("4");
  });

  it("updates direct attr cell bindings without the generic dynAttr wrapper", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const value = cell("alpha");
    mount(() => h("input", { type: "text", value: attr(value) }), root);

    const input = root.querySelector("input");
    expect(input?.value).toBe("alpha");

    set(value, "beta");
    await flushMicrotask();

    expect(input?.value).toBe("beta");
  });

  it("renders Show fallback and swaps branches through reactive props", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const visible = cell(true);
    mount(
      () =>
        h(
          "section",
          null,
          h(
            Show,
            {
              when: dynBlock(() => get(visible)),
              fallback: h("p", null, "hidden"),
            },
            h("span", null, "visible"),
          ),
        ),
      root,
    );

    expect(root.textContent).toBe("visible");

    set(visible, false);
    await flushMicrotask();
    expect(root.textContent).toBe("hidden");

    set(visible, true);
    await flushMicrotask();
    expect(root.textContent).toBe("visible");
  });

  it("renders Show children correctly when the condition is an object value", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const selected = cell<{ title: string } | null>({ title: "Active task" });

    mount(
      () =>
        h(
          "aside",
          null,
          h(
            Show,
            {
              when: dynAttr(() => get(selected)),
              fallback: h("p", null, "empty"),
            },
            h("section", null, h("h2", null, dynText(() => get(selected)?.title ?? "missing"))),
          ),
        ),
      root,
    );

    expect(root.querySelector("h2")?.textContent).toBe("Active task");
    expect(root.textContent).not.toContain("[object Object]");

    set(selected, null);
    await flushMicrotask();

    expect(root.textContent).toBe("empty");
  });

  it("navigates internal anchors through the router without a custom Link component", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const router = createRouter([
      { path: "/", view: () => h("h2", null, "Home") },
      { path: "/about", view: () => h("h2", null, "About") },
    ]);

    mount(
      () =>
        h(
          "main",
          null,
          h(
            "nav",
            null,
            h("a", { href: "/", "data-active": router.isActive("/") }, "Home"),
            h("a", { href: "/about", "data-active": router.isActive("/about") }, "About"),
          ),
          router.view(),
        ),
      root,
    );

    const links = root.querySelectorAll("a");
    expect(root.querySelector("h2")?.textContent).toBe("Home");
    expect(links[0]?.getAttribute("data-active")).toBe("");
    expect(links[1]?.getAttribute("data-active")).toBeNull();

    links[1]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushMicrotask();

    expect(window.location.pathname).toBe("/about");
    expect(router.currentPath()).toBe("/about");
    expect(root.querySelector("h2")?.textContent).toBe("About");
    expect(links[0]?.getAttribute("data-active")).toBeNull();
    expect(links[1]?.getAttribute("data-active")).toBe("");
  });

  it("renders For with keyed items through reactive props", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const items = cell([
      { id: 1, label: "One" },
      { id: 2, label: "Two" },
    ]);

    mount(
      () =>
        h(
          "ul",
          null,
          h(
            For,
            {
              each: dynBlock(() => get(items)),
              key: (item: { id: number }) => item.id,
            },
            (item: { label: string }) => h("li", null, item.label),
          ),
        ),
      root,
    );

    expect(Array.from(root.querySelectorAll("li"), (entry) => entry.textContent)).toEqual(["One", "Two"]);

    set(items, [
      { id: 2, label: "Two" },
      { id: 3, label: "Three" },
    ]);
    await flushMicrotask();

    expect(Array.from(root.querySelectorAll("li"), (entry) => entry.textContent)).toEqual(["Two", "Three"]);
  });

  it("updates text when nested store properties change", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const state = store({
      counter: {
        value: 1,
      },
    });

    mount(() => h("p", null, dynText(() => state.counter.value)), root);
    expect(root.textContent).toBe("1");

    state.counter.value = 2;
    await flushMicrotask();

    expect(root.textContent).toBe("2");
  });

  it("updates list-like output when store arrays mutate in place", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const todos = store([
      { title: "Alpha" },
      { title: "Beta" },
    ]);

    mount(() => h("p", null, dynText(() => todos.map((todo) => todo.title).join(", "))), root);
    expect(root.textContent).toBe("Alpha, Beta");

    todos.push({ title: "Gamma" });
    await flushMicrotask();
    expect(root.textContent).toBe("Alpha, Beta, Gamma");

    todos[1]!.title = "Beta 2";
    await flushMicrotask();
    expect(root.textContent).toBe("Alpha, Beta 2, Gamma");
  });

  it("clones static templates on mount without using the fallback builder", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    let fallbackCalls = 0;
    mount(
      () =>
        h(
          "section",
          null,
          tpl('<div class="hero"><strong>Hel</strong><span>Static</span></div>', () => {
            fallbackCalls += 1;
            return h("div", { class: "hero" }, h("strong", null, "Hel"), h("span", null, "Static"));
          }),
        ),
      root,
    );

    expect(fallbackCalls).toBe(0);
    expect(root.querySelector(".hero")?.textContent).toBe("HelStatic");
  });

  it("uses the fallback builder for templates during hydration", () => {
    const root = document.createElement("div");
    root.innerHTML = '<section><div class="hero"><strong>Hel</strong><span>Static</span></div></section>';
    document.body.appendChild(root);

    let fallbackCalls = 0;
    hydrate(
      () =>
        h(
          "section",
          null,
          tpl('<div class="hero"><strong>Hel</strong><span>Static</span></div>', () => {
            fallbackCalls += 1;
            return h("div", { class: "hero" }, h("strong", null, "Hel"), h("span", null, "Static"));
          }),
        ),
      root,
    );

    expect(fallbackCalls).toBe(1);
    expect(root.querySelector(".hero")?.textContent).toBe("HelStatic");
  });

  it("clones static fragment templates on mount", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    mount(
      () =>
        h(
          "section",
          null,
          tpl("<span>One</span><span>Two</span>", () => frag(h("span", null, "One"), h("span", null, "Two"))),
        ),
      root,
    );

    const spans = root.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(Array.from(spans, (entry) => entry.textContent)).toEqual(["One", "Two"]);
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

  it("preserves focused textarea and select nodes during block updates", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const state = store({
      detail: {
        priority: "medium",
        note: "Alpha",
      },
    });

    mount(
      () =>
        h(
          "section",
          null,
          dynBlock(() =>
            h(
              "div",
              null,
              h(
                "select",
                {
                  value: dynAttr(() => state.detail.priority),
                  onChange: (event: Event) => {
                    state.detail.priority = (event.currentTarget as HTMLSelectElement).value;
                  },
                },
                h("option", { value: "low" }, "Low"),
                h("option", { value: "medium" }, "Medium"),
                h("option", { value: "high" }, "High"),
              ),
              h("textarea", {
                value: dynAttr(() => state.detail.note),
                onInput: (event: Event) => {
                  state.detail.note = (event.currentTarget as HTMLTextAreaElement).value;
                },
              }),
            ),
          ),
        ),
      root,
    );

    const selectBefore = root.querySelector("select")!;
    const textareaBefore = root.querySelector("textarea")!;

    textareaBefore.focus();
    expect(document.activeElement).toBe(textareaBefore);

    textareaBefore.value = "Beta";
    textareaBefore.dispatchEvent(new window.Event("input", { bubbles: true }));
    await flushMicrotask();

    const selectAfterInput = root.querySelector("select")!;
    const textareaAfterInput = root.querySelector("textarea")!;
    expect(selectAfterInput).toBe(selectBefore);
    expect(textareaAfterInput).toBe(textareaBefore);
    expect(document.activeElement).toBe(textareaBefore);
    expect(textareaAfterInput.value).toBe("Beta");

    selectBefore.focus();
    expect(document.activeElement).toBe(selectBefore);

    selectBefore.value = "high";
    selectBefore.dispatchEvent(new window.Event("change", { bubbles: true }));
    await flushMicrotask();

    const selectAfterChange = root.querySelector("select")!;
    expect(selectAfterChange).toBe(selectBefore);
    expect(document.activeElement).toBe(selectBefore);
    expect(selectAfterChange.value).toBe("high");
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

  it("patches stable block slot content in place instead of clearing the block", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const count = cell(1);
    mount(
      () =>
        h(
          "section",
          null,
          dynBlock(() => h("article", { class: "panel" }, h("h2", null, "Stats"), h("p", null, `Count ${get(count)}`))),
        ),
      root,
    );

    const articleBefore = root.querySelector("article");
    resetRuntimeStats();

    set(count, 2);
    await flushMicrotask();

    const stats = getRuntimeStats();
    const articleAfter = root.querySelector("article");

    expect(articleAfter).toBe(articleBefore);
    expect(stats.domInsertions).toBe(0);
    expect(stats.domRemovals).toBe(0);
    expect(stats.domReplacements).toBe(0);
    expect(stats.textPatches).toBe(1);
    expect(root.textContent).toContain("Count 2");
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

  it("disposes block-scoped effects when a branch is removed", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const visible = cell(true);
    const count = cell(1);

    mount(
      () =>
        h(
          "section",
          null,
          dynBlock(() =>
            get(visible)
              ? h("p", { class: "value" }, dynText(() => get(count)))
              : h("p", { class: "hidden" }, "off"),
          ),
        ),
      root,
    );

    expect(count.subscribers.size).toBe(1);
    expect(root.querySelector(".value")?.textContent).toBe("1");

    set(visible, false);
    await flushMicrotask();

    expect(root.querySelector(".value")).toBeNull();
    expect(count.subscribers.size).toBe(0);

    set(count, 2);
    await flushMicrotask();

    expect(root.querySelector(".hidden")?.textContent).toBe("off");
    expect(count.subscribers.size).toBe(0);
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

  it("avoids reinserting stable keyed list nodes when order does not change", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const items = cell([
      { id: "a", label: "Alpha", value: 1 },
      { id: "b", label: "Beta", value: 2 },
      { id: "c", label: "Gamma", value: 3 },
    ]);

    mount(
      () =>
        h(
          "ul",
          null,
          list(
            () => get(items),
            (item) => item.id,
            (item) => h("li", { "data-id": item.id }, `${item.label}:${item.value}`),
          ),
        ),
      root,
    );

    const listRoot = root.querySelector("ul");
    expect(listRoot).not.toBeNull();
    const nodesBefore = Array.from(root.querySelectorAll("li"));

    const insertBeforeSpy = vi.spyOn(listRoot!, "insertBefore");

    set(items, [
      get(items)[0],
      { id: "b", label: "Beta", value: 5 },
      get(items)[2],
    ]);
    await flushMicrotask();

    expect(insertBeforeSpy).toHaveBeenCalledTimes(0);
    expect(Array.from(root.querySelectorAll("li"), (entry) => entry.textContent)).toEqual([
      "Alpha:1",
      "Beta:5",
      "Gamma:3",
    ]);
    const nodesAfter = Array.from(root.querySelectorAll("li"));
    expect(nodesAfter[0]).toBe(nodesBefore[0]);
    expect(nodesAfter[1]).toBe(nodesBefore[1]);
    expect(nodesAfter[2]).toBe(nodesBefore[2]);
  });

  it("patches stable keyed table rows in place instead of replacing row roots", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const rows = cell(
      Array.from({ length: 20 }, (_, index) => ({
        id: `row-${index}`,
        label: `Row ${index}`,
        value: index,
      })),
    );

    mount(
      () =>
        h(
          "table",
          null,
          h(
            "tbody",
            null,
            list(
              () => get(rows),
              (row) => row.id,
              (row) => h("tr", null, h("td", null, row.label), h("td", null, row.value)),
            ),
          ),
        ),
      root,
    );

    const rowNodesBefore = Array.from(root.querySelectorAll("tr"));
    resetRuntimeStats();

    set(
      rows,
      get(rows).map((row, index) => (index % 5 === 0 ? { ...row, value: row.value + 10 } : row)),
    );
    await flushMicrotask();

    const stats = getRuntimeStats();
    const rowNodesAfter = Array.from(root.querySelectorAll("tr"));

    expect(stats.domInsertions).toBe(0);
    expect(stats.domRemovals).toBe(0);
    expect(stats.domReplacements).toBe(0);
    expect(stats.textPatches).toBe(4);
    expect(stats.inPlacePatches).toBeGreaterThan(0);
    expect(rowNodesAfter).toEqual(rowNodesBefore);
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

  it("does not double-bind hydrated event listeners", () => {
    const root = document.createElement("div");
    const count = cell(0);

    root.innerHTML = '<button>Increment</button>';
    document.body.appendChild(root);

    hydrate(() => h("button", { onClick: () => set(count, get(count) + 1) }, "Increment"), root);

    const button = root.querySelector("button");
    expect(button).not.toBeNull();

    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(get(count)).toBe(1);

    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(get(count)).toBe(2);
  });

  it("keeps branch event handlers working after block switches", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const visible = cell(true);
    const count = cell(0);

    mount(
      () =>
        h(
          "section",
          null,
          dynBlock(() =>
            get(visible)
              ? h("button", { onClick: () => set(count, get(count) + 1) }, "Primary")
              : h("button", { onClick: () => set(count, get(count) + 10) }, "Secondary"),
          ),
        ),
      root,
    );

    let button = root.querySelector("button");
    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(get(count)).toBe(1);

    set(visible, false);
    await flushMicrotask();

    button = root.querySelector("button");
    expect(button?.textContent).toBe("Secondary");
    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(get(count)).toBe(11);
  });
});
