import path from "node:path";
import { defineConfig } from "vitest/config";
import { helMagicPlugin } from "./src/framework/compiler/plugin";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin()],
  test: {
    environment: "happy-dom",
    include: [
      "src/framework/compiler/**/*.test.ts",
      "src/framework/compiler/**/*.test.tsx",
      "src/framework/runtime/**/*.test.ts",
      "src/framework/runtime/**/*.test.tsx",
      "src/framework/server/**/*.test.ts",
      "src/framework/server/**/*.test.tsx",
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
