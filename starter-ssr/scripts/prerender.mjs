import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const htmlPath = path.join(root, "dist", "index.html");
const serverEntryPath = path.join(root, "dist", "server", "entry-server.js");

const html = await readFile(htmlPath, "utf8");
const { renderApp } = await import(pathToFileURL(serverEntryPath).href);
const appHtml = renderApp();

const nextHtml = html.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`);
await writeFile(htmlPath, nextHtml, "utf8");
