import { defineConfig } from "vite";
import { helMagicPlugin } from "heljs/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
});
