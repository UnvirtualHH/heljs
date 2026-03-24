import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outdir = path.join(root, "dist", "package");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    runtime: "src/framework/package/runtime.ts",
    server: "src/framework/package/server.ts",
    vite: "src/framework/package/vite.ts",
  },
  outdir,
  bundle: true,
  format: "esm",
  splitting: true,
  sourcemap: true,
  target: "es2022",
  platform: "neutral",
  mainFields: ["module", "main"],
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  external: [
    "vite",
    "@babel/parser",
    "@babel/generator",
    "@babel/traverse",
    "@babel/types",
    "node:path",
  ],
});
