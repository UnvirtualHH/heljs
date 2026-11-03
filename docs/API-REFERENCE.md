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
- returns a function that unmounts the root: it stops all effects, runs cleanups, and empties the target

#### `hydrate(render, target)`

Hydrates existing prerendered markup under `target`.

```ts
hydrate(() => <App />, document.getElementById("app")!);
```

Notes:

- use this when SSR markup already exists
- falls back locally on mismatches instead of hard-failing globally
- returns a function that unmounts the root, like `mount`

#### Events

`onClick` is delegated: there is one listener on `document`, and a walk from the target upward reproduces bubbling, including `currentTarget` and `stopPropagation`. A list with a handler per row would otherwise pay for every listener twice. All other events use `addEventListener` on the element.

This has three consequences, the same as in Solid:

- a click on an element that is not in the document does not reach its handler
- a click event dispatched without `bubbles: true` does not either
- a listener you add yourself to an ancestor runs before `onClick` handlers below it

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

- each property is tracked separately
- deep object and array mutations trigger updates
- works in a component and at module level
- `Date` and `Map` values are not supported yet

#### `untrack(fn)`

Runs `fn` without subscribing to what it reads. Use it for an explicit snapshot.

```ts
const initial = untrack(() => count);
```

#### `memo(fn, lazy?)`

Returns a getter for a value that is computed once per change. The compiler emits this for a `const` that reads state, so app code rarely needs it directly. With `lazy`, the first computation waits for the first read.

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
- a row stays alive when its key brings a new object, so its state and focus survive a refetch
- in compiled code, the parameters read the current item and index, like props

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
- with `key`, uses keyed list semantics internally, and rows stay alive as described for `list`

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

### Async Data

#### `useResource(source, fetcher, options?)`

Loads data and keeps it in step with `source`.

```tsx
const pet = useResource(() => `/api/pets/${props.id}`, getJson);

return pet.loading ? <Spinner /> : <PetDetails pet={pet.value} />;
```

- `source()` is tracked and identifies the data. A falsy value means "do not fetch". If its value did not change, nothing happens.
- `fetcher(source, signal)` is untracked. The `signal` aborts when the source changes or the component goes away, and an outdated response is ignored either way.

| Member | Meaning |
| --- | --- |
| `value` | The data, or `undefined`. **Throws if the last request failed**, unless you check `error` first |
| `error` | The failure |
| `loading` | Whether a request is running |
| `refetch()` | Runs again, keeps the value while loading, and clears the error |

| Option | Meaning |
| --- | --- |
| `initial` | Starts with this value. While hydrating, it also skips the first fetch |
| `keepPrevious` | Keeps the old value when the source changes |

There is no cache, deduplication, or retry. On the server it never fetches: it reports `loading`, or returns `initial`.

### Errors

#### `ErrorBoundary(props)`

Shows a fallback when something below it throws.

```tsx
<ErrorBoundary fallback={(error, retry) => <Oops error={error} onRetry={retry} />}>
  <PetPage id={id} />
</ErrorBoundary>
```

`fallback` is JSX or a function receiving the error and `retry`, which renders the children again from scratch.

It catches component setup, slots, keyed rows, `effect`, `onMount`, and reading the `value` of a failed resource. A throwing fallback goes to the next boundary out. It does not catch event handlers and their promises, which stay with the browser, or `onCleanup`, which goes to `reportError`.

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

The view is rebuilt when the matched route changes, or when something read in the view's own body changes. Component setup is untracked, so `<Todo id={router.params().id} />` keeps the component when the id changes, and its reads update. Its local state stays too.

#### `router.hasMatch()`

Whether a route matches the current path, for example to answer with a 404 on the server.

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

### `serializeData(value)`

Turns preloaded data into text that is safe inside a `<script>`. A plain `JSON.stringify` is not, because a value containing `</script>` would break out of it.

```ts
const pets = await api.pets();
const html = renderToString(() => <App pets={pets} />);
const page = `${html}<script>window.__DATA__ = ${serializeData({ pets })}</script>`;
```

### Shared SSR exports

`hel/server` also exposes the same small helper surface needed by compiled SSR output, including:

- `h`
- `frag`
- `For`
- `Show`
- `list`
- `store`
- `branch`
- `useResource`
- `ErrorBoundary`

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

- transform components and `use*` functions, also in plain `.ts` files
- rewrite reactive `let` and derived `const`
- emit specialized runtime calls for text, attributes, blocks, and branches

## Current Constraints

These constraints are part of the current public behavior and should be treated as real:

- components are PascalCase functions, anonymous default exports containing JSX, or functions containing JSX passed to a call
- reactive `let` destructuring is not supported
- component parameters must be a plain identifier or an object pattern
- `list(...)` is the official keyed list story
- the router is intentionally small
- async components and `async use*` functions are compile errors

## Recommended Reading Order

1. [GETTING-STARTED.md](C:/projects/hellscript/codex%20version/docs/GETTING-STARTED.md)
2. [README.md](C:/projects/hellscript/codex%20version/README.md)
3. [RELEASING.md](C:/projects/hellscript/codex%20version/docs/RELEASING.md)
4. [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
