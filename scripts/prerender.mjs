import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const distHtmlPath = path.resolve(root, "dist/index.html");
const serverEntryPath = path.resolve(root, "dist/server/entry-server.js");

const [{ renderApp }, html] = await Promise.all([
  import(pathToFileURL(serverEntryPath).href),
  readFile(distHtmlPath, "utf8"),
]);

if (typeof renderApp !== "function") {
  throw new Error("SSR bundle does not export renderApp()");
}

const renderedApp = renderApp();
const nextHtml = html.replace(/<div id="app">[\s\S]*?<\/div>/, `<div id="app">${renderedApp}</div>`);

if (nextHtml === html) {
  throw new Error("Could not locate #app container in dist/index.html");
}

await writeFile(distHtmlPath, nextHtml, "utf8");
