import { renderToString, serializeData } from "heljs/server";
import { handleApi } from "../server/api";
import { App } from "./App";
import { catalogUrl, ORDERS_URL, orderUrl, petUrl, relatedUrl, reviewsUrl } from "./lib/urls";
import { router } from "./router";
import type { Pet } from "./types";

export { handleApi, resetApi } from "../server/api";

async function load(preloaded: Record<string, unknown>, url: string): Promise<number> {
  const result = await handleApi("GET", url);
  if (result.status === 200) {
    preloaded[url] = result.body;
  }
  return result.status;
}

// By hand, per route: what each page wants in its first HTML.
async function preload(pathname: string, query: Record<string, string>): Promise<{ preloaded: Record<string, unknown>; status: number }> {
  const preloaded: Record<string, unknown> = {};
  let status = 200;
  const pet = pathname.match(/^\/pets\/([^/]+)$/);
  const order = pathname.match(/^\/orders\/([^/]+)$/);

  if (pathname === "/") {
    await load(preloaded, catalogUrl(query));
  } else if (pet) {
    status = await load(preloaded, petUrl(pet[1]!));
    if (status === 200) {
      await load(preloaded, reviewsUrl(pet[1]!));
      await load(preloaded, relatedUrl(preloaded[petUrl(pet[1]!)] as Pet));
    }
  } else if (pathname === "/orders") {
    await load(preloaded, ORDERS_URL);
  } else if (order) {
    status = await load(preloaded, orderUrl(order[1]!));
  }

  return { preloaded, status };
}

export async function renderPage(url: string): Promise<{ html: string; data: string; status: number }> {
  const { pathname, searchParams } = new URL(url, "http://shop.local");
  const { preloaded, status } = await preload(pathname, Object.fromEntries(searchParams.entries()));

  // Rendering is synchronous, so no other request can change the shared router in between.
  router.navigate(url);
  const html = renderToString(() => <App preloaded={preloaded} />);

  return { html, data: serializeData(preloaded), status: router.hasMatch() ? status : 404 };
}
