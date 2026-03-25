# API Reference

This is the current public API surface for `Hel`. It describes what is available today, not an imagined future `1.0`.

The public entry points are:

- `hel` or `hel/runtime`
- `hel/server`
- `hel/vite`

## `hel` / `hel/runtime`

### Rendering

#### `mount(render, target)`

Mounts a render function into a target element.

```ts
mount(() => <App />, document.getElementById("app")!);
```

Notes:

- use this for pure client rendering
- `render` should return one renderable tree

#### `hydrate(render, target)`

Hydrates existing prerendered markup under `target`.

```ts
hydrate(() => <App />, document.getElementById("app")!);
```

Notes:

- use this when SSR markup already exists
- falls back locally on mismatches instead of hard-failing globally

#### `h(...)`

Low-level JSX runtime helper used by the compiler. You usually do not call it manually.

#### `frag(...children)`

Fragment helper used by the compiler and available when needed for manual runtime work.

### Reactivity

#### `store(value)`

Creates a small proxy-based local store for objects and arrays.

```ts
const todos = store([{ title: "Ship Hel", done: false }]);
todos[0].done = true;
todos.push({ title: "Write docs", done: false });
```

Current semantics:

- local and intentionally coarse-grained
- deep object and array mutations trigger updates
- not a full fine-grained Solid-style store graph

#### `cell(value)`, `get(cell)`, `set(cell, value)`, `effect(fn)`

Publicly exported low-level runtime primitives.

These exist because the runtime is built on them, but normal app code is expected to prefer:

- `let` for local state
- helper functions
- JSX

### Context

#### `createContext(defaultValue)`

Creates a minimal shared context with a provider component.

```ts
const AuthContext = createContext({ role: "guest" });
```

#### `useContext(context)`

Reads the nearest context value from the current provider subtree.

```ts
const auth = useContext(AuthContext);
```

#### `Context.Provider`

Provides a context value to descendant JSX children.

```tsx
<AuthContext.Provider value={{ role: "admin" }}>
  <RoleBadge />
</AuthContext.Provider>
```

Current semantics:

- works on client and server
- rerenders the provider subtree when the provider value changes
- falls back to the default value when no provider is present

### Lists and Control Flow

#### `list(read, key, render)`

Explicit keyed list primitive.

```ts
list(
  () => todos,
  (todo) => todo.id,
  (todo) => <li>{todo.title}</li>,
)
```

Current guarantees:

- keyed DOM reuse on reorder
- SSR and hydration compatible
- each item should render exactly one root node

#### `For(props)`

Control-flow helper for lists.

```tsx
<For each={todos} key={(todo) => todo.id} fallback={<p>Empty</p>}>
  {(todo) => <TodoRow todo={todo} />}
</For>
```

Props:

- `each`
- optional `key`
- optional `fallback`
- `children`

Behavior:

- without `key`, behaves like unkeyed `map(...)`
- with `key`, uses keyed list semantics internally

#### `Show(props)`

Small conditional helper.

```tsx
<Show when={visible} fallback={<p>Hidden</p>}>
  <Panel />
</Show>
```

Props:

- `when`
- optional `fallback`
- `children`

Normal ternaries in JSX remain the default option.

### Router

#### `createRouter(routes, options?)`

Creates a small HTML-first router.

```ts
const router = createRouter([
  { path: "/", view: () => <Home /> },
  { path: "/todos/:id", view: () => <Todo id={router.params().id} /> },
]);
```

Current route definition:

```ts
type RouteDefinition = {
  path: string;
  view: () => unknown;
};
```

#### `router.view()`

Returns the current route view as a renderable value.

#### `router.currentPath()`

Returns the currently active normalized path.

#### `router.params()`

Returns current route params.

```ts
router.params().id
```

#### `router.query()`

Returns current query params as a plain object.

```ts
router.query().filter
```

#### `router.navigate(target, options?)`

Navigates to a path or delegates to browser history for numeric values.

```ts
router.navigate("/about");
router.navigate(-1);
```

#### `router.href(path, query?)`

Builds a router-aware href string.

```ts
router.href("/todos", { filter: "done" });
```

#### `router.setQuery(patch, options?)`

Updates query state by patching the current query object.

```ts
router.setQuery({ filter: "open" }, { replace: true });
router.setQuery({ filter: null }, { replace: true });
```

#### `router.isActive(path)`

Checks whether the current route matches the given path.

```ts
router.isActive("/about");
router.isActive("/todos/:id");
```

Current router scope:

- normal `<a href>` links first
- route params
- query params
- history integration

Not included yet:

- nested routes
- guards
- loaders or actions

## `hel/server`

### `renderToString(render)`

Renders a component tree to an HTML string for SSR.

```ts
import { renderToString } from "hel/server";

const html = renderToString(() => <App />);
```

### `createRouter(routes, options?)`

Static router variant for SSR.

The API mirrors the client router closely:

- `view()`
- `currentPath()`
- `params()`
- `query()`
- `href()`
- `setQuery()`
- `navigate()`

Numeric navigation is a no-op on the server.

### Shared SSR exports

`hel/server` also exposes the same small helper surface needed by compiled SSR output, including:

- `h`
- `frag`
- `For`
- `Show`
- `list`
- `store`
- `branch`

## `hel/vite`

### `helMagicPlugin()`

Vite plugin that applies the Hel compiler transform.

```ts
import { defineConfig } from "vite";
import { helMagicPlugin } from "hel/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
});
```

Current responsibilities:

- transform PascalCase components
- rewrite reactive `let`
- analyze local helper functions
- emit specialized runtime calls for text, attributes, blocks, and branches

## Current Constraints

These constraints are part of the current public behavior and should be treated as real:

- only PascalCase components are transformed
- reactive `let` destructuring is not supported
- component parameters must currently be a simple identifier
- `store(...)` is intentionally local and coarse-grained
- `list(...)` is the official keyed list story
- the router is intentionally small

## Recommended Reading Order

1. [GETTING-STARTED.md](C:/projects/hellscript/codex%20version/docs/GETTING-STARTED.md)
2. [README.md](C:/projects/hellscript/codex%20version/README.md)
3. [RELEASING.md](C:/projects/hellscript/codex%20version/docs/RELEASING.md)
4. [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
