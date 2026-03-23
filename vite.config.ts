import path from "node:path";
import { defineConfig } from "vitest/config";
import { helMagicPlugin } from "./src/framework/plugin";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@hel/runtime": path.resolve(
        __dirname,
        isSsrBuild ? "src/framework/server.ts" : "src/framework/runtime.ts",
      ),
    },
  },
}));
