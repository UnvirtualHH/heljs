import { defineConfig } from "vite";
import { helMagicPlugin } from "heljs/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "src/main.tsx",
      output: {
        format: "iife",
        entryFileNames: "main.js",
      },
    },
  },
});
