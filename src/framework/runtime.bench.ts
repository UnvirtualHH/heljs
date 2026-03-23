import { bench, beforeEach, describe } from "vitest";
import { cell, dynBlock, get, h, hydrate, list, mount, set, text } from "./runtime";
import { frag as serverFrag, h as serverH, list as serverList, renderToString } from "./server";

function flushMicrotask(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function createRoot(): HTMLDivElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

function destroyRoot(root: HTMLDivElement): void {
  root.remove();
}

describe("runtime benchmarks", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  bench("counter mount", () => {
    const root = createRoot();
    const count = cell(0);

    mount(
      () => h("section", null, h("h1", null, "Count"), h("p", null, text(count)), h("button", null, "+")),
      root,
    );

    destroyRoot(root);
  });

  bench("counter update", async () => {
    const root = createRoot();
    const count = cell(0);

    mount(
      () => h("section", null, h("h1", null, "Count"), h("p", null, text(count)), h("button", null, "+")),
      root,
    );

    set(count, 1);
    await flushMicrotask();
    destroyRoot(root);
  });

  bench("counter hydrate", () => {
    const root = document.createElement("section");
    root.innerHTML = renderToString(() => serverFrag(serverH("h1", null, "Count"), serverH("p", null, "0"), serverH("button", null, "+")));
    document.body.appendChild(root);

    const count = cell(0);
    hydrate(
      () => [h("h1", null, "Count"), h("p", null, text(count)), h("button", null, "+")],
      root,
    );

    root.remove();
  });

  bench("table update", async () => {
    const root = createRoot();
    const rows = cell(
      Array.from({ length: 100 }, (_, index) => ({
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
              (row) =>
                h("tr", null, h("td", null, row.label), h("td", null, row.value)),
            ),
          ),
        ),
      root,
    );

    set(
      rows,
      get(rows).map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row)),
    );
    await flushMicrotask();
    destroyRoot(root);
  });

  bench("list toggle update", async () => {
    const root = createRoot();
    const visible = cell(true);
    const items = cell(Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` })));

    mount(
      () =>
        h(
          "section",
          null,
          dynBlock(() =>
            get(visible)
              ? h(
                  "ul",
                  null,
                  list(
                    () => get(items),
                    (item) => item.id,
                    (item) => h("li", null, item.label),
                  ),
                )
              : h("p", null, "hidden"),
          ),
        ),
      root,
    );

    set(visible, false);
    await flushMicrotask();
    set(visible, true);
    await flushMicrotask();
    destroyRoot(root);
  });

  bench("list hydrate and reorder", async () => {
    const root = createRoot();
    const items = cell(Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` })));

    root.innerHTML = renderToString(() =>
      serverH(
        "ul",
        null,
        serverList(
          () => Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` })),
          (item) => item.id,
          (item) => serverH("li", null, item.label),
        ),
      ),
    );

    hydrate(
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

    set(items, [...get(items)].reverse());
    await flushMicrotask();
    destroyRoot(root);
  });
});
