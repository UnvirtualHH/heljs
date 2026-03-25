# Getting Started

`Hel` is currently a compiler-first framework prototype with:

- local `let` state
- direct DOM instead of a virtual DOM
- a small HTML-first router
- SSR and hydration
- a Vite plugin for the AST transform

The fastest way to get started is to work against the built package first instead of importing internal source files directly.

## Prerequisites

- Node.js 22
- npm

## 1. Build Hel in the framework repo

Inside the Hel repo:

```bash
npm install
npm run build:package
```

That generates the consumable package artifacts under `dist/package`.

## 2. Create a new client project

Minimal `package.json` excerpt:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hel": "file:../hel"
  }
}
```

## 3. Configure Vite

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { helMagicPlugin } from "hel/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
});
```

## 4. Write a first component

`src/main.tsx`:

```tsx
import { h, mount } from "hel/runtime";

function App() {
  let count = 0;

  return (
    <main>
      <h1>Hel Starter</h1>
      <button onClick={() => count++}>Count: {count}</button>
    </main>
  );
}

mount(<App />, document.getElementById("app")!);
```

Important:

- components must use PascalCase names
- local reactive state is `let`
- normal `const` helpers are fine
- there is no `signal()`, `effect()`, or `memo()` in user code

## 5. Start the dev server

```bash
npm run dev
```

## Minimal Router Example

```tsx
import { createRouter, h, mount } from "hel/runtime";

const router = createRouter([
  { path: "/", view: () => <h1>Home</h1> },
  { path: "/about", view: () => <h1>About</h1> },
]);

function App() {
  return (
    <>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      {router.view()}
    </>
  );
}
```

Normal `<a href>` tags are the default. The router only intercepts known internal routes.

## Minimal SSR Example

A working SSR example already exists in the repo:

- [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)

Important for external SSR projects:

- client code imports from `hel/runtime`
- the SSR build must alias `hel/runtime` to `hel/server`

That is already implemented in [starter-ssr/vite.config.ts](C:/projects/hellscript/codex%20version/starter-ssr/vite.config.ts).

## Verified Examples in the Repo

- Client-only starter:
  - [starter](C:/projects/hellscript/codex%20version/starter)
- SSR starter:
  - [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)
- Larger demo app:
  - [src/demo](C:/projects/hellscript/codex%20version/src/demo)

## Known Limits

- reactive `let` destructuring is not implemented yet
- component parameters currently must be a simple identifier
- `list(...)` is the official keyed list story
- `store(...)` is intentionally local and coarse-grained
- the router is intentionally small: no nested routes, guards, or loader or action APIs

## Useful Next Documents

- Architecture:
  - [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
- Release and publish guide:
  - [RELEASING.md](C:/projects/hellscript/codex%20version/docs/RELEASING.md)
