import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { helMagicPlugin } from "hel/vite";

// In development the API runs inside Vite, with a delay so loading states show.
function apiPlugin(): Plugin {
  return {
    name: "pet-shop-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }

        const { handleApi } = await server.ssrLoadModule("/server/api.ts");
        let body = "";
        for await (const chunk of request) {
          body += chunk;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
        const result = await handleApi(request.method, request.url, body, request.headers.authorization);
        response.statusCode = result.status;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result.body));
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin(), apiPlugin()],
  resolve: {
    alias: [
      {
        find: "hel/runtime",
        replacement: isSsrBuild ? "hel/server" : path.resolve(__dirname, "node_modules/hel/dist/package/runtime.js"),
      },
    ],
  },
}));
