import { describe, expect, it } from "vitest";
import { dynBlock, h, node, renderToString } from "./server";

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
});
