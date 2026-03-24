import path from "node:path";
import { defineConfig } from "vite";
import { helMagicPlugin } from "hel/vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin()],
  resolve: {
    alias: [
      {
        find: "hel/runtime",
        replacement: isSsrBuild ? "hel/server" : path.resolve(__dirname, "node_modules/hel/dist/package/runtime.js"),
      },
    ],
  },
}));
