# SSR and Hydration Guide

This document describes the current SSR and hydration model in `Hel`.

It is intentionally scoped to what exists today:

- server rendering to HTML strings
- marker-based hydration
- local mismatch fallback
- small router integration

It is not a full meta-framework data loading model.

## Mental Model

`Hel` uses the same component and JSX surface for both:

- client rendering
- server rendering

At build time there are two execution targets:

- `hel/runtime` for the browser
- `hel/server` for SSR

The important rule is:

- the client mounts or hydrates DOM
- the server renders HTML strings
- both sides must agree on structure and slot boundaries

## What SSR Produces

The server renderer outputs:

- normal HTML for static structure
- marker comments for dynamic block ranges
- the initial values for text and attributes

That means the client does not need to rebuild the whole tree after load. It can claim the existing DOM and attach runtime behavior.

## What Hydration Does

Hydration takes prerendered DOM and turns it into a live Hel tree.

At a high level:

1. it walks the existing DOM under the target root
2. it claims the nodes and markers expected by the compiled output
3. it attaches event handlers
4. it registers reactive slot updates
5. future state changes patch the claimed DOM instead of replacing the whole root

The intended result is:

- one DOM tree
- no duplicate roots
- no full client remount on the happy path

## Public Runtime Entry Points

### Client

```ts
import { hydrate, mount } from "hel/runtime";
```

- use `mount(...)` when there is no prerendered HTML
- use `hydrate(...)` when there is prerendered HTML already in the target root

Example:

```tsx
const root = document.getElementById("app");

if (!(root instanceof Element)) {
  throw new Error("Missing #app root");
}

if (root.firstChild) {
  hydrate(() => <App />, root);
} else {
  mount(() => <App />, root);
}
```

### Server

```ts
import { renderToString } from "hel/server";
```

Example:

```tsx
export function renderApp() {
  return renderToString(() => <App />);
}
```

## Current Build Flow in This Repo

`npm run build` currently does:

1. client bundle build
2. SSR bundle build
3. prerender step that writes app HTML into `dist/index.html`

That means the built demo already exercises the real SSR -> hydration path.

## External SSR Consumer Setup

There is a verified external example in:

- [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)

Important rule for external SSR projects:

- app code still imports from `hel/runtime`
- the SSR build must alias `hel/runtime` to `hel/server`

Example from the starter:

```ts
import path from "node:path";
import { defineConfig } from "vite";
import { helMagicPlugin } from "hel/vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [helMagicPlugin()],
  resolve: {
    alias: [
      {
        find: "hel/runtime",
        replacement: isSsrBuild
          ? "hel/server"
          : path.resolve(__dirname, "node_modules/hel/dist/package/runtime.js"),
      },
    ],
  },
}));
```

That split is required because the compiled application code imports runtime helpers through the public runtime path, while SSR needs the server implementation behind the same surface.

## Router + SSR

The current router works on both client and server.

Supported today:

- static routes
- route params
- query params
- normal anchors as the primary navigation path

On the server:

- `createRouter(...)` can render the current route view
- `params()` and `query()` are available
- numeric navigation is a no-op

On the client:

- internal anchors are intercepted
- `popstate` is wired
- `router.view()` updates as path and query change

## Mismatch Behavior

Hydration is not allowed to fail silently in a dangerous way.

Current behavior:

- in development: warn with path information
- in production: remount the smallest affected local subtree

This is a practical tradeoff:

- do not hard-fail the whole app for one mismatch
- do not silently keep a broken hydration tree alive

## Current Limits

Hydration is solid on the intended path, but the contract is still not fully locked down.

Still open:

- full structural equivalence guarantees for every edge case
- more formal marker contract documentation
- broader fragment and structural edge-case coverage
- explicit browser support matrix

## Current Recommendations

Use SSR and hydration today if:

- you control the build pipeline
- you use the verified runtime and server entry points
- you stay within the current documented framework constraints

Do not assume yet:

- a final `1.0` hydration contract
- meta-framework features such as loaders, actions, or nested route orchestration

## Related Docs

1. [GETTING-STARTED.md](C:/projects/hellscript/codex%20version/docs/GETTING-STARTED.md)
2. [API-REFERENCE.md](C:/projects/hellscript/codex%20version/docs/API-REFERENCE.md)
3. [REACTIVITY.md](C:/projects/hellscript/codex%20version/docs/REACTIVITY.md)
4. [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
