import { describe, expect, it } from "vitest";
import { branch, createRouter, dynBlock, For, h, list, node, renderToString, Show } from "./index";

describe("server renderer", () => {
  it("renders block markers for dynamic regions", () => {
    const html = renderToString(() =>
      h(
        "main",
        null,
        node(() => h("h1", null, "Hel")),
        dynBlock(() => h("p", null, "Ready")),
      ),
    );

    expect(html).toMatchInlineSnapshot(
      "\"<main><h1>Hel</h1><!--hs:block:start--><p>Ready</p><!--hs:block:end--></main>\"",
    );
  });

  it("renders retained branch slots with the same block markers used by hydration", () => {
    const html = renderToString(() =>
      h(
        "main",
        null,
        branch(
          () => true,
          () => h("ul", null, h("li", null, "Alpha")),
          () => h("p", null, "hidden"),
        ),
      ),
    );

    expect(html).toMatchInlineSnapshot(
      "\"<main><!--hs:block:start--><ul><li>Alpha</li></ul><!--hs:block:end--></main>\"",
    );
  });

  it("renders keyed lists with the same block markers used by hydration", () => {
    const html = renderToString(() =>
      h(
        "ul",
        null,
        list(
          () => [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
          (item) => item.id,
          (item) => h("li", { "data-id": item.id }, item.label),
        ),
      ),
    );

    expect(html).toMatchInlineSnapshot(
      "\"<ul><!--hs:block:start--><li data-id=\"a\">Alpha</li><li data-id=\"b\">Beta</li><!--hs:block:end--></ul>\"",
    );
  });

  it("renders Show and For helper components", () => {
    const html = renderToString(() =>
      h(
        "section",
        null,
        h(
          Show,
          { when: true, fallback: h("p", null, "fallback") },
          h("strong", null, "visible"),
        ),
        h(
          "ul",
          null,
          h(
            For,
            {
              each: [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
              ],
              key: (item: { id: string }) => item.id,
            },
            (item: { label: string }) => h("li", null, item.label),
          ),
        ),
      ),
    );

    expect(html).toContain("<strong>visible</strong>");
    expect(html).toContain("<li>Alpha</li>");
    expect(html).toContain("<li>Beta</li>");
    expect(html).not.toContain("fallback");
  });

  it("renders For fallback when the list is empty", () => {
    const html = renderToString(() =>
      h(
        "ul",
        null,
        h(
          For,
          {
            each: [],
            fallback: h("li", { class: "empty" }, "Empty"),
          },
          (item: { label: string }) => h("li", null, item.label),
        ),
      ),
    );

    expect(html).toContain('<li class="empty">Empty</li>');
  });

  it("renders the current static route on the server", () => {
    const router = createRouter(
      [
        { path: "/", view: () => h("h2", null, "Home") },
        { path: "/about", view: () => h("h2", null, "About") },
      ],
      { initialPath: "/about" },
    );

    const html = renderToString(() => h("main", null, router.view()));

    expect(html).toContain("<h2>About</h2>");
    expect(html).not.toContain("<h2>Home</h2>");
  });

  it("renders param routes with the current params on the server", () => {
    const router = createRouter(
      [
        { path: "/", view: () => h("h2", null, "Home") },
        { path: "/todos/:id", view: () => h("h2", null, `Todo ${router.params().id ?? "missing"}`) },
      ],
      { initialPath: "/todos/claim-dom" },
    );

    const html = renderToString(() => h("main", null, router.view()));

    expect(html).toContain("<h2>Todo claim-dom</h2>");
    expect(router.params().id).toBe("claim-dom");
  });

  it("renders query-dependent routes while keeping the current path stable on the server", () => {
    const router = createRouter(
      [
        { path: "/todos", view: () => h("h2", null, `Filter ${router.query().filter ?? "all"}`) },
      ],
      { initialPath: "/todos?filter=done" },
    );

    const html = renderToString(() => h("main", null, router.view()));

    expect(html).toContain("<h2>Filter done</h2>");
    expect(router.currentPath()).toBe("/todos");
    expect(router.query().filter).toBe("done");
  });

  it("builds hrefs and merges query patches on the server", () => {
    const router = createRouter(
      [
        { path: "/todos", view: () => h("h2", null, `Filter ${router.query().filter ?? "all"}`) },
      ],
      { initialPath: "/todos?filter=done" },
    );

    expect(router.href("/todos", { filter: "open", page: 2 })).toBe("/todos?filter=open&page=2");

    router.setQuery({ filter: "open", page: 2 });
    expect(router.query()).toEqual({ filter: "open", page: "2" });

    router.setQuery({ filter: null });
    expect(router.query()).toEqual({ page: "2" });
  });

  it("ignores numeric navigation on the server", () => {
    const router = createRouter(
      [
        { path: "/", view: () => h("h2", null, "Home") },
        { path: "/about", view: () => h("h2", null, "About") },
      ],
      { initialPath: "/about" },
    );

    router.navigate(-1);

    expect(router.currentPath()).toBe("/about");
    expect(renderToString(() => h("main", null, router.view()))).toContain("<h2>About</h2>");
  });
});
