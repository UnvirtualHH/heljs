import path from "node:path";
import { defineConfig } from "vitest/config";
import { helMagicPlugin } from "heljs/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: [
      {
        find: "heljs/runtime",
        replacement: path.resolve(__dirname, "node_modules/heljs/dist/package/runtime.js"),
      },
    ],
  },
});
