import path from "node:path";
import { defineConfig } from "vitest/config";
import { helMagicPlugin } from "hel/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: [
      {
        find: "hel/runtime",
        replacement: path.resolve(__dirname, "node_modules/hel/dist/package/runtime.js"),
      },
    ],
  },
});
