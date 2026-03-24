import { bench, beforeEach, describe } from "vitest";
import { cell, dynBlock, effect, get, getRuntimeStats, h, hydrate, list, mount, resetRuntimeStats, set, text } from "./index";
import { frag as serverFrag, h as serverH, list as serverList, renderToString } from "../server/index";
import { createApp, h as vueH, nextTick, ref as vueRef } from "vue";
import { createElement as reactCreateElement } from "react";
import { createRoot as createReactRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const FAST_BENCH = {
  time: 800,
  warmupTime: 200,
};

const SLOW_BENCH = {
  time: 1500,
  warmupTime: 300,
};

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

async function flushVue(): Promise<void> {
  await nextTick();
}

function mountReactCounter(root: Element) {
  const reactRoot = createReactRoot(root);
  let count = 0;

  const render = () =>
    reactRoot.render(
      reactCreateElement("section", null,
        reactCreateElement("h1", null, "Count"),
        reactCreateElement("p", null, String(count)),
        reactCreateElement("button", null, "+"),
      ),
    );

  flushSync(render);

  return {
    setCount(next: number) {
      count = next;
      flushSync(render);
    },
    unmount() {
      flushSync(() => reactRoot.unmount());
    },
  };
}

function mountReactTable(root: Element) {
  const reactRoot = createReactRoot(root);
  let rows = Array.from({ length: 100 }, (_, index) => ({
    id: `row-${index}`,
    label: `Row ${index}`,
    value: index,
  }));

  const render = () =>
    reactRoot.render(
      reactCreateElement(
        "table",
        null,
        reactCreateElement(
          "tbody",
          null,
          rows.map((row) =>
            reactCreateElement(
              "tr",
              { key: row.id },
              reactCreateElement("td", null, row.label),
              reactCreateElement("td", null, String(row.value)),
            ),
          ),
        ),
      ),
    );

  flushSync(render);

  return {
    updateRows() {
      rows = rows.map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row));
      flushSync(render);
    },
    unmount() {
      flushSync(() => reactRoot.unmount());
    },
  };
}

function mountReactListToggle(root: Element) {
  const reactRoot = createReactRoot(root);
  let visible = true;
  const items = Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` }));

  const render = () =>
    reactRoot.render(
      reactCreateElement(
        "section",
        null,
        visible
          ? reactCreateElement(
              "ul",
              null,
              items.map((item) => reactCreateElement("li", { key: item.id }, item.label)),
            )
          : reactCreateElement("p", null, "hidden"),
      ),
    );

  flushSync(render);

  return {
    hide() {
      visible = false;
      flushSync(render);
    },
    show() {
      visible = true;
      flushSync(render);
    },
    unmount() {
      flushSync(() => reactRoot.unmount());
    },
  };
}

function naiveRenderCounter(target: Element, count: number): void {
  const section = document.createElement("section");
  const heading = document.createElement("h1");
  heading.textContent = "Count";
  const value = document.createElement("p");
  value.textContent = String(count);
  const button = document.createElement("button");
  button.textContent = "+";

  section.append(heading, value, button);
  target.replaceChildren(section);
}

function naiveRenderTable(
  target: Element,
  rows: Array<{ id: string; label: string; value: number }>,
): void {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");

  for (const row of rows) {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = row.label;
    const value = document.createElement("td");
    value.textContent = String(row.value);
    tr.append(label, value);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  target.replaceChildren(table);
}

function naiveRenderListToggle(
  target: Element,
  visible: boolean,
  items: Array<{ id: number; label: string }>,
): void {
  const section = document.createElement("section");

  if (visible) {
    const list = document.createElement("ul");
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item.label;
      list.appendChild(entry);
    }
    section.appendChild(list);
  } else {
    const hidden = document.createElement("p");
    hidden.textContent = "hidden";
    section.appendChild(hidden);
  }

  target.replaceChildren(section);
}

function mountVueCounter(root: Element) {
  const count = vueRef(0);
  const app = createApp({
    setup() {
      return () =>
        vueH("section", null, [
          vueH("h1", null, "Count"),
          vueH("p", null, String(count.value)),
          vueH("button", null, "+"),
        ]);
    },
  });

  app.mount(root);

  return {
    setCount(next: number) {
      count.value = next;
    },
    unmount() {
      app.unmount();
    },
  };
}

function mountVueTable(root: Element) {
  const rows = vueRef(
    Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      value: index,
    })),
  );

  const app = createApp({
    setup() {
      return () =>
        vueH(
          "table",
          null,
          vueH(
            "tbody",
            null,
            rows.value.map((row) =>
              vueH("tr", { key: row.id }, [vueH("td", null, row.label), vueH("td", null, String(row.value))]),
            ),
          ),
        );
    },
  });

  app.mount(root);

  return {
    updateRows() {
      rows.value = rows.value.map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row));
    },
    unmount() {
      app.unmount();
    },
  };
}

function mountVueListToggle(root: Element) {
  const visible = vueRef(true);
  const items = Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` }));

  const app = createApp({
    setup() {
      return () =>
        vueH("section", null, [
          visible.value
            ? vueH(
                "ul",
                null,
                items.map((item) => vueH("li", { key: item.id }, item.label)),
              )
            : vueH("p", null, "hidden"),
        ]);
    },
  });

  app.mount(root);

  return {
    hide() {
      visible.value = false;
    },
    show() {
      visible.value = true;
    },
    unmount() {
      app.unmount();
    },
  };
}

describe("runtime benchmarks", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetRuntimeStats();
  });

  bench("counter mount", () => {
    const root = createRoot();
    const count = cell(0);

    mount(
      () => h("section", null, h("h1", null, "Count"), h("p", null, text(count)), h("button", null, "+")),
      root,
    );
    destroyRoot(root);
  }, FAST_BENCH);

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
  }, FAST_BENCH);

  bench("naive counter mount", () => {
    const root = createRoot();
    naiveRenderCounter(root, 0);
    destroyRoot(root);
  }, FAST_BENCH);

  bench("naive counter update", () => {
    const root = createRoot();
    naiveRenderCounter(root, 0);
    naiveRenderCounter(root, 1);
    destroyRoot(root);
  }, FAST_BENCH);

  bench("vue counter update", async () => {
    const root = createRoot();
    const app = mountVueCounter(root);
    app.setCount(1);
    await flushVue();
    app.unmount();
    destroyRoot(root);
  }, FAST_BENCH);

  bench("react counter update", () => {
    const root = createRoot();
    const app = mountReactCounter(root);
    app.setCount(1);
    app.unmount();
    destroyRoot(root);
  }, FAST_BENCH);

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
  }, FAST_BENCH);

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
  }, SLOW_BENCH);

  bench("naive table update", () => {
    const root = createRoot();
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      value: index,
    }));

    naiveRenderTable(root, rows);
    naiveRenderTable(
      root,
      rows.map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row)),
    );
    destroyRoot(root);
  }, SLOW_BENCH);

  bench("vue table update", async () => {
    const root = createRoot();
    const app = mountVueTable(root);
    app.updateRows();
    await flushVue();
    app.unmount();
    destroyRoot(root);
  }, SLOW_BENCH);

  bench("react table update", () => {
    const root = createRoot();
    const app = mountReactTable(root);
    app.updateRows();
    app.unmount();
    destroyRoot(root);
  }, SLOW_BENCH);

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
  }, SLOW_BENCH);

  bench("naive list toggle update", () => {
    const root = createRoot();
    const items = Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` }));

    naiveRenderListToggle(root, true, items);
    naiveRenderListToggle(root, false, items);
    naiveRenderListToggle(root, true, items);
    destroyRoot(root);
  }, SLOW_BENCH);

  bench("vue list toggle update", async () => {
    const root = createRoot();
    const app = mountVueListToggle(root);
    app.hide();
    await flushVue();
    app.show();
    await flushVue();
    app.unmount();
    destroyRoot(root);
  }, SLOW_BENCH);

  bench("react list toggle update", () => {
    const root = createRoot();
    const app = mountReactListToggle(root);
    app.hide();
    app.show();
    app.unmount();
    destroyRoot(root);
  }, SLOW_BENCH);

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
  }, SLOW_BENCH);

  bench("reactivity fanout update", async () => {
    const source = cell(0);
    const disposers = Array.from({ length: 1000 }, () =>
      effect(() => {
        get(source);
      }),
    );

    set(source, 1);
    await flushMicrotask();
    getRuntimeStats();

    for (const dispose of disposers) {
      dispose();
    }
  }, SLOW_BENCH);

  bench("reactivity setup and cleanup", () => {
    const source = cell(0);
    const disposers = Array.from({ length: 1000 }, () =>
      effect(() => {
        get(source);
      }),
    );

    for (const dispose of disposers) {
      dispose();
    }
  }, SLOW_BENCH);
});
