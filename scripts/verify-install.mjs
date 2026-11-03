// Installs the real tarball into a fresh project outside this repository, the way a
// user would, so nothing can resolve through this repository's node_modules. Then it
// typechecks, builds for client and server, renders, and hydrates the result.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const project = mkdtempSync(path.join(tmpdir(), "hel-install-"));
const keep = process.argv.includes("--keep");

function run(label, command, cwd = project) {
  const started = Date.now();
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8" });

  if (result.status !== 0) {
    console.error(`FAILED: ${label}\n${result.stdout}\n${result.stderr}`);
    process.exit(1);
  }

  console.log(`ok: ${label} (${Date.now() - started} ms)`);
  return result.stdout;
}

function write(file, content) {
  const target = path.join(project, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function check(label, passed) {
  if (!passed) {
    console.error(`FAILED: ${label}`);
    process.exit(1);
  }

  console.log(`ok: ${label}`);
}

write("package.json", JSON.stringify({ name: "fresh-project", private: true, type: "module" }, null, 2));

write(
  "tsconfig.json",
  JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", strict: true, skipLibCheck: true, noEmit: true },
    include: ["src", "vite.config.ts"],
  }),
);

write(
  "vite.config.ts",
  `import { defineConfig } from "vite";
import { helMagicPlugin } from "${name}/vite";

export default defineConfig({ plugins: [helMagicPlugin()] });
`,
);

write(
  "index.html",
  `<!doctype html><html><body><div id="app"><!--app--></div><script type="module" src="/src/main.tsx"></script></body></html>`,
);

write(
  "src/counter.ts",
  `export function useCounter(start: number) {
  let count = start;
  const doubled = count * 2;

  function increment() {
    count += 1;
  }

  return { count, doubled, increment };
}
`,
);

write(
  "src/App.tsx",
  `import { createContext, createRouter, ErrorBoundary, For, useContext, useResource } from "${name}/runtime";
import { useCounter } from "./counter";

const Theme = createContext("default");

function Reader() {
  return <em>{useContext(Theme)}</em>;
}

function Bad(): any {
  throw new Error("expected");
}

export const router = createRouter([{ path: "/", view: () => <h2>home</h2> }]);

export function App(props: { pets?: string[] }) {
  const counter = useCounter(1);
  const pets = useResource(() => "/pets", async () => ["fetched"], { initial: props.pets });

  return (
    <main>
      <Theme.Provider value="provided"><Reader /></Theme.Provider>
      <button id="count" onClick={counter.increment}>{counter.count} / {counter.doubled}</button>
      <ul>
        <For each={pets.value ?? []} key={(pet: string) => pet}>{(pet: string) => <li>{pet}</li>}</For>
      </ul>
      <ErrorBoundary fallback={<p id="caught">caught</p>}><Bad /></ErrorBoundary>
      {router.view()}
      <svg viewBox="0 0 1 1"><circle r="1" /></svg>
    </main>
  );
}
`,
);

write(
  "src/main.tsx",
  `import { hydrate } from "${name}/runtime";
import { App } from "./App";

hydrate(() => <App pets={["preloaded"]} />, document.getElementById("app")!);
`,
);

write(
  "src/entry-server.tsx",
  `import { renderToString, serializeData } from "${name}/server";
import { App, router } from "./App";

export function render(url: string) {
  router.navigate(url);
  return { html: renderToString(() => <App pets={["preloaded"]} />), data: serializeData({ a: "</script>" }) };
}
`,
);

try {
  run("npm pack", `npm pack --pack-destination "${project}"`, root);
  const tarball = readdirSync(project).find((file) => file.endsWith(".tgz"));
  check(`tarball for ${name}@${version}`, Boolean(tarball));

  run("install the tarball", `npm install --no-audit --no-fund "./${tarball}" typescript`);

  const installed = readFileSync(path.join(project, "package-lock.json"), "utf8");
  check("vite came with the package", installed.includes('"node_modules/vite"'));
  for (const unwanted of ["node_modules/react", "node_modules/vue", "node_modules/solid-js"]) {
    check(`${unwanted} was not installed`, !installed.includes(`"${unwanted}"`));
  }

  run("typecheck", "npx tsc --noEmit");
  run("client build", "npx vite build --outDir dist/client");
  run("server build, with hel/runtime resolved to the server", "npx vite build --ssr src/entry-server.tsx --outDir dist/server");

  const consoleError = console.error;
  console.error = () => {};
  const { render } = await import(pathToFileURL(path.join(project, "dist/server/entry-server.js")).href);
  const { html, data } = render("/");
  console.error = consoleError;

  check("server renders the provider", html.includes("<em>provided</em>"));
  check("server renders preloaded rows", html.includes("<li>preloaded</li>"));
  check("server catches an error", html.includes('<p id="caught">caught</p>'));
  check("server renders the route", html.includes("<h2>home</h2>"));
  check("serializeData is safe", !data.includes("</script>"));

  const assets = path.join(project, "dist/client/assets");
  const bundle = readdirSync(assets).find((file) => file.endsWith(".js"));
  const code = readFileSync(path.join(assets, bundle), "utf8");
  check("the client bundle has no development warnings", !code.includes("ran outside a component"));

  const window = new Window({ url: "http://localhost/" });
  const globals = ["document", "Node", "Element", "HTMLElement", "SVGElement", "HTMLSelectElement", "HTMLAnchorElement", "MouseEvent", "Event", "DocumentFragment", "Text", "Comment"];
  globalThis.window = window;
  for (const key of globals) {
    globalThis[key] = window[key];
  }
  window.document.body.innerHTML = `<div id="app">${html}</div>`;

  const warnings = [];
  const consoleWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  console.error = () => {};
  const button = window.document.querySelector("#count");
  await import(pathToFileURL(path.join(assets, bundle)).href);
  await new Promise((resolve) => setTimeout(resolve, 20));
  console.warn = consoleWarn;

  check("hydration claims the server's nodes", window.document.querySelector("#count") === button);
  check("the circle is in the SVG namespace", window.document.querySelector("circle").namespaceURI === "http://www.w3.org/2000/svg");

  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("a click updates through the shared hook", button.textContent === "2 / 4");
  console.error = consoleError;

  console.log(`\nA fresh install of ${name}@${version} works.`);
} finally {
  if (keep) {
    console.log(`Kept ${project}`);
  } else {
    rmSync(project, { recursive: true, force: true, maxRetries: 3 });
  }
}

process.exit(0);
