import { describe, expect, it } from "vitest";
import { dynBlock, h, list, node, renderToString } from "./server";

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
});
