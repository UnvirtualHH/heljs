import { describe, expect, it } from "vitest";
import { createRouter, dynBlock, For, h, list, node, renderToString, Show } from "./server";

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
});
