import path from "node:path";
import { defineConfig } from "vitest/config";
import { helMagicPlugin } from "./src/framework/compiler/plugin";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin()],
  test: {
    environment: "happy-dom",
    include: [
      "src/framework/compiler/**/*.test.ts",
      "src/framework/runtime/**/*.test.ts",
      "src/framework/server/**/*.test.ts",
    ],
  },
  benchmark: {
    include: ["src/framework/runtime/**/*.bench.ts"],
  },
  resolve: {
    alias: [
      {
        find: "hel/runtime",
        replacement: path.resolve(
          __dirname,
          isSsrBuild ? "src/framework/server/index.ts" : "src/framework/runtime/index.ts",
        ),
      },
    ],
  },
}));
