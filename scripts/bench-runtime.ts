import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { branch, cell, get, h, list, mount, resetRuntimeStats, set, text } from "../src/framework/runtime/index.ts";

type BenchCase = {
  name: string;
  iterations: number;
  warmups: number;
  rounds: number;
  run: () => void | Promise<void>;
};

type BenchResult = {
  name: string;
  iterations: number;
  rounds: number;
  hz: number;
  minHz: number;
  maxHz: number;
  meanMs: number;
  rme: number;
};

const windowInstance = new Window();
globalThis.window = windowInstance as unknown as typeof globalThis.window;
globalThis.document = windowInstance.document;
globalThis.Node = windowInstance.Node as unknown as typeof globalThis.Node;
globalThis.Element = windowInstance.Element as unknown as typeof globalThis.Element;
globalThis.HTMLElement = windowInstance.HTMLElement as unknown as typeof globalThis.HTMLElement;
globalThis.SVGElement = windowInstance.SVGElement as unknown as typeof globalThis.SVGElement;
globalThis.HTMLInputElement = windowInstance.HTMLInputElement as unknown as typeof globalThis.HTMLInputElement;
globalThis.HTMLTextAreaElement = windowInstance.HTMLTextAreaElement as unknown as typeof globalThis.HTMLTextAreaElement;
globalThis.HTMLSelectElement = windowInstance.HTMLSelectElement as unknown as typeof globalThis.HTMLSelectElement;
globalThis.DocumentFragment = windowInstance.DocumentFragment as unknown as typeof globalThis.DocumentFragment;
globalThis.Comment = windowInstance.Comment as unknown as typeof globalThis.Comment;
globalThis.Text = windowInstance.Text as unknown as typeof globalThis.Text;
globalThis.Event = windowInstance.Event as unknown as typeof globalThis.Event;
globalThis.CustomEvent = windowInstance.CustomEvent as unknown as typeof globalThis.CustomEvent;
globalThis.performance = performance as unknown as Performance;
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: windowInstance.navigator,
});

const { createApp, h: vueH, nextTick, ref: vueRef } = await import("vue");
const { createElement: reactCreateElement } = await import("react");
const { createRoot: createReactRoot } = await import("react-dom/client");
const { flushSync } = await import("react-dom");
const { createSignal: createSolidSignal } = await import("solid-js");
const { render: renderSolid } = await import("solid-js/web");
const { default: solidH } = await import("solid-js/h");

function createRoot(): HTMLDivElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

function destroyRoot(root: HTMLDivElement): void {
  root.remove();
}

function flushHel(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function resetDom(): void {
  document.body.innerHTML = "";
  resetRuntimeStats();
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

function naiveRenderTable(target: Element, rows: Array<{ id: string; label: string; value: number }>): void {
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

function naiveRenderListToggle(target: Element, visible: boolean, items: Array<{ id: number; label: string }>): void {
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
    async setCount(next: number) {
      count.value = next;
      await nextTick();
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
    async updateRows() {
      rows.value = rows.value.map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row));
      await nextTick();
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
            ? vueH("ul", null, items.map((item) => vueH("li", { key: item.id }, item.label)))
            : vueH("p", null, "hidden"),
        ]);
    },
  });

  app.mount(root);

  return {
    async hide() {
      visible.value = false;
      await nextTick();
    },
    async show() {
      visible.value = true;
      await nextTick();
    },
    unmount() {
      app.unmount();
    },
  };
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
          ? reactCreateElement("ul", null, items.map((item) => reactCreateElement("li", { key: item.id }, item.label)))
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

function mountSolidCounter(root: Element) {
  const [count, setCount] = createSolidSignal(0);
  const dispose = renderSolid(() => solidH("section", null, solidH("h1", null, "Count"), solidH("p", null, count), solidH("button", null, "+")), root);

  return {
    setCount(next: number) {
      setCount(next);
    },
    unmount() {
      dispose();
    },
  };
}

function mountSolidTable(root: Element) {
  const [rows, setRows] = createSolidSignal(
    Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      value: index,
    })),
  );

  const dispose = renderSolid(
    () =>
      solidH(
        "table",
        null,
        solidH(
          "tbody",
          null,
          () =>
            rows().map((row) =>
              solidH("tr", null, solidH("td", null, row.label), solidH("td", null, () => String(row.value))),
            ),
        ),
      ),
    root,
  );

  return {
    updateRows() {
      setRows((current) => current.map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row)));
    },
    unmount() {
      dispose();
    },
  };
}

function mountSolidListToggle(root: Element) {
  const [visible, setVisible] = createSolidSignal(true);
  const items = Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` }));

  const dispose = renderSolid(
    () =>
      solidH(
        "section",
        null,
        () =>
          visible()
            ? solidH(
                "ul",
                null,
                items.map((item) => solidH("li", null, item.label)),
              )
            : solidH("p", null, "hidden"),
      ),
    root,
  );

  return {
    hide() {
      setVisible(false);
    },
    show() {
      setVisible(true);
    },
    unmount() {
      dispose();
    },
  };
}

function createCases(): BenchCase[] {
  return [
    {
      name: "hel counter update",
      iterations: 1000,
      warmups: 50,
      rounds: 5,
      async run() {
        resetDom();
        const root = createRoot();
        const count = cell(0);
        mount(() => h("section", null, h("h1", null, "Count"), h("p", null, text(count)), h("button", null, "+")), root);
        set(count, 1);
        await flushHel();
        destroyRoot(root);
      },
    },
    {
      name: "naive counter update",
      iterations: 1000,
      warmups: 50,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        naiveRenderCounter(root, 0);
        naiveRenderCounter(root, 1);
        destroyRoot(root);
      },
    },
    {
      name: "vue counter update",
      iterations: 1000,
      warmups: 50,
      rounds: 5,
      async run() {
        resetDom();
        const root = createRoot();
        const app = mountVueCounter(root);
        await app.setCount(1);
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "react counter update",
      iterations: 1000,
      warmups: 50,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const app = mountReactCounter(root);
        app.setCount(1);
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "solid counter update",
      iterations: 1000,
      warmups: 50,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const app = mountSolidCounter(root);
        app.setCount(1);
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "hel table update",
      iterations: 120,
      warmups: 10,
      rounds: 5,
      async run() {
        resetDom();
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
                  (row) => h("tr", null, h("td", null, row.label), h("td", null, row.value)),
                ),
              ),
            ),
          root,
        );

        set(rows, get(rows).map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row)));
        await flushHel();
        destroyRoot(root);
      },
    },
    {
      name: "naive table update",
      iterations: 120,
      warmups: 10,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const rows = Array.from({ length: 100 }, (_, index) => ({
          id: `row-${index}`,
          label: `Row ${index}`,
          value: index,
        }));
        naiveRenderTable(root, rows);
        naiveRenderTable(root, rows.map((row, index) => (index % 10 === 0 ? { ...row, value: row.value + 1 } : row)));
        destroyRoot(root);
      },
    },
    {
      name: "vue table update",
      iterations: 120,
      warmups: 10,
      rounds: 5,
      async run() {
        resetDom();
        const root = createRoot();
        const app = mountVueTable(root);
        await app.updateRows();
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "react table update",
      iterations: 120,
      warmups: 10,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const app = mountReactTable(root);
        app.updateRows();
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "solid table update",
      iterations: 120,
      warmups: 10,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const app = mountSolidTable(root);
        app.updateRows();
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "hel list toggle update",
      iterations: 200,
      warmups: 15,
      rounds: 5,
      async run() {
        resetDom();
        const root = createRoot();
        const visible = cell(true);
        const items = cell(Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` })));

        mount(
          () =>
            h(
              "section",
              null,
              branch(
                () => get(visible),
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
                () => h("p", null, "hidden"),
              ),
            ),
          root,
        );

        set(visible, false);
        await flushHel();
        set(visible, true);
        await flushHel();
        destroyRoot(root);
      },
    },
    {
      name: "naive list toggle update",
      iterations: 200,
      warmups: 15,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const items = Array.from({ length: 50 }, (_, index) => ({ id: index, label: `Item ${index}` }));
        naiveRenderListToggle(root, true, items);
        naiveRenderListToggle(root, false, items);
        naiveRenderListToggle(root, true, items);
        destroyRoot(root);
      },
    },
    {
      name: "vue list toggle update",
      iterations: 200,
      warmups: 15,
      rounds: 5,
      async run() {
        resetDom();
        const root = createRoot();
        const app = mountVueListToggle(root);
        await app.hide();
        await app.show();
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "react list toggle update",
      iterations: 200,
      warmups: 15,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const app = mountReactListToggle(root);
        app.hide();
        app.show();
        app.unmount();
        destroyRoot(root);
      },
    },
    {
      name: "solid list toggle update",
      iterations: 200,
      warmups: 15,
      rounds: 5,
      run() {
        resetDom();
        const root = createRoot();
        const app = mountSolidListToggle(root);
        app.hide();
        app.show();
        app.unmount();
        destroyRoot(root);
      },
    },
  ];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rme(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  const sem = sd / Math.sqrt(values.length);
  const moe = 1.96 * sem;
  return (moe / avg) * 100;
}

async function runCase(testCase: BenchCase): Promise<BenchResult> {
  for (let index = 0; index < testCase.warmups; index += 1) {
    await testCase.run();
  }

  const roundHz: number[] = [];
  const roundMs: number[] = [];

  for (let round = 0; round < testCase.rounds; round += 1) {
    const start = performance.now();
    for (let iteration = 0; iteration < testCase.iterations; iteration += 1) {
      await testCase.run();
    }
    const duration = performance.now() - start;
    const hz = testCase.iterations / (duration / 1000);
    roundHz.push(hz);
    roundMs.push(duration / testCase.iterations);
  }

  return {
    name: testCase.name,
    iterations: testCase.iterations,
    rounds: testCase.rounds,
    hz: mean(roundHz),
    minHz: Math.min(...roundHz),
    maxHz: Math.max(...roundHz),
    meanMs: mean(roundMs),
    rme: rme(roundHz),
  };
}

function formatResult(result: BenchResult): string {
  return [
    result.name.padEnd(26),
    `${result.hz.toFixed(2)} hz`.padStart(14),
    `mean ${result.meanMs.toFixed(3)} ms`.padStart(14),
    `rme ±${result.rme.toFixed(2)}%`.padStart(13),
  ].join("  ");
}

async function main(): Promise<void> {
  const cases = createCases();
  const results: BenchResult[] = [];

  for (const testCase of cases) {
    const result = await runCase(testCase);
    results.push(result);
    console.log(formatResult(result));
  }

  await writeFile(
    new URL("../bench-runtime-results.json", import.meta.url),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
}

await main();
