import { describe, expect, it } from "vitest";
import { measureTransforms } from "./metrics";

describe("transform metrics", () => {
  it("reports specialized wrapper usage for common samples", () => {
    const rows = measureTransforms();

    const counter = rows.find((entry) => entry.name === "counter");
    const form = rows.find((entry) => entry.name === "form");
    const staticTree = rows.find((entry) => entry.name === "staticTree");
    const listBlock = rows.find((entry) => entry.name === "listBlock");

    expect(counter).toBeDefined();
    expect(counter?.text).toBe(1);
    expect(counter?.dynText).toBe(0);

    expect(form).toBeDefined();
    expect(form?.attr).toBe(2);
    expect(form?.dynAttr).toBe(0);

    expect(staticTree).toBeDefined();
    expect(staticTree?.tpl).toBeGreaterThanOrEqual(1);

    expect(listBlock).toBeDefined();
    expect(listBlock?.dynBlock).toBeGreaterThanOrEqual(1);
  });
});
