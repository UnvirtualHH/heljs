import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const clientDir = path.join(root, "dist", "client");
const { handleApi, renderPage } = await import(pathToFileURL(path.join(root, "dist", "server", "entry-server.js")).href);
const template = await readFile(path.join(clientDir, "index.html"), "utf8");
const port = Number(process.env.PORT ?? 4300);

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".map": "application/json" };

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

createServer(async (request, response) => {
  const url = request.url ?? "/";

  try {
    if (url.startsWith("/api/")) {
      const result = await handleApi(request.method, url, await readBody(request), request.headers.authorization);
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
      return;
    }

    const file = path.join(clientDir, new URL(url, "http://shop.local").pathname);
    if (file.startsWith(clientDir) && file !== path.join(clientDir, "index.html") && existsSync(file) && statSync(file).isFile()) {
      response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(response);
      return;
    }

    const { html, data, status } = await renderPage(url);
    const page = template
      .replace("<!--app-->", () => html)
      .replace("<!--data-->", () => `<script>window.__DATA__ = ${data}</script>`);
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Internal server error");
  }
}).listen(port, () => {
  console.log(`Pet shop on http://localhost:${port}`);
});
