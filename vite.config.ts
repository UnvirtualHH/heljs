import path from "node:path";
import { defineConfig } from "vitest/config";
import { helMagicPlugin } from "./src/framework/compiler/plugin";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  benchmark: {
    include: ["src/**/*.bench.ts"],
  },
  resolve: {
    alias: [
      {
        find: "@hel/runtime",
        replacement: path.resolve(
          __dirname,
          isSsrBuild ? "src/framework/server/index.ts" : "src/framework/runtime/index.ts",
        ),
      },
    ],
  },
}));
