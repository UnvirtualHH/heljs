import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, hydrate } from "hel/runtime";
import { handleApi, resetApi } from "../server/api";
import { App } from "../src/App";
import { router } from "../src/router";

// Built by "npm run build:server": the real server bundle against the real client.
const server = await import(/* @vite-ignore */ pathToFileURL(path.resolve("dist/server/entry-server.js")).href);

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let warn: ReturnType<typeof vi.spyOn>;
let requests: string[];
let unmount: (() => void) | undefined;

beforeEach(() => {
  resetApi();
  server.resetApi();
  requests = [];
  document.body.innerHTML = "";
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    requests.push(url);
    const result = await handleApi(init.method ?? "GET", url, (init.body as string) ?? "");
    return { ok: result.status < 400, status: result.status, json: async () => result.body };
  });
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  warn.mockRestore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function hydrateRoute(url: string) {
  const { html, data, status } = await server.renderPage(url);
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  const elements = [...root.querySelectorAll("*")];
  const script = data.replaceAll("\\u003c", "<").replaceAll("\\u003e", ">").replaceAll("\\u0026", "&");

  router.navigate(url);
  unmount = hydrate(() => h(App as never, { preloaded: JSON.parse(script) }), root);
  const claimed = elements.filter((element) => element.isConnected).length;

  return { root, html, status, claimed, total: elements.length };
}

describe("every route hydrates what the server rendered", () => {
  const routes: Array<[string, number, string, string[]]> = [
    ["/", 200, "#search", []],
    ["/?q=mi&sort=name", 200, ".card", []],
    ["/?species=cat&page=1", 200, ".card", []],
    ["/pets/1", 200, ".pet", []],
    ["/pets/999", 404, "header", ["/api/pets/999"]],
    ["/cart", 200, "h1", []],
    ["/checkout", 200, "h1", []],
    ["/orders", 200, "h1", []],
    ["/orders/9999", 404, "header", ["/api/orders/9999"]],
    ["/login", 200, "#login-form", []],
    ["/admin", 200, "#admin-locked", []],
    ["/does-not-exist", 404, ".route-miss", []],
  ];

  for (const [url, status, selector, expectedRequests] of routes) {
    it(url, async () => {
      const result = await hydrateRoute(url);

      expect(result.status).toBe(status);
      expect(result.html).not.toContain("[object");
      expect(warn).not.toHaveBeenCalled();
      expect(result.claimed).toBe(result.total);
      expect(result.root.querySelector(selector)).not.toBeNull();
      expect(requests).toEqual(expectedRequests);
    });
  }

  it("shows the preloaded data in the HTML", async () => {
    const { html } = await hydrateRoute("/pets/1");

    expect(html).toContain("<h1>Bello</h1>");
    expect(html).toContain("Ate my homework");
    expect(html).toContain("You might also like");
  });

  it("selects the sort order in the HTML", async () => {
    const { html } = await server.renderPage("/?sort=name");

    expect(html).toContain('<option value="name" selected>');
  });

  it("does not let a value break out of the data script", async () => {
    await server.handleApi("PATCH", "/api/pets/1", JSON.stringify({ name: "</script><script>alert(1)</script>" }), "Bearer admin-token");
    const { html, data } = await server.renderPage("/");

    expect(data).not.toContain("</script>");
    expect(html).not.toContain("<script>alert");
  });

  it("is interactive after hydrating", async () => {
    const { root } = await hydrateRoute("/");
    const add = root.querySelector<HTMLButtonElement>(".card .add")!;

    add.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await wait();

    expect(root.querySelector("#cart-count")?.textContent).toBe("1");
  });
});
