# Hel

![Hel logo](public/hel-192.png)

A compiler-first prototype for a framework without a virtual DOM.

The goal is Solid-style fine-grained reactivity, but with normal TypeScript in user code:

- `let` for local state
- normal functions and closures
- JSX without `signal()`, `effect()`, or `memo()` in user code
- HTML-first routing with normal `<a href>` links
- direct DOM updates instead of VDOM diffing

The current state is a usable M2 prototype with client rendering, SSR HTML output, and a hydration MVP.

Additional docs:

- Getting started: [GETTING-STARTED.md](C:/projects/hellscript/codex%20version/docs/GETTING-STARTED.md)
- API reference: [API-REFERENCE.md](C:/projects/hellscript/codex%20version/docs/API-REFERENCE.md)
- SSR and hydration: [SSR-HYDRATION.md](C:/projects/hellscript/codex%20version/docs/SSR-HYDRATION.md)
- Reactivity model: [REACTIVITY.md](C:/projects/hellscript/codex%20version/docs/REACTIVITY.md)
- Performance guide: [PERFORMANCE.md](C:/projects/hellscript/codex%20version/docs/PERFORMANCE.md)
- Limits and non-goals: [LIMITS-AND-NON-GOALS.md](C:/projects/hellscript/codex%20version/docs/LIMITS-AND-NON-GOALS.md)
- Release and publish flow: [RELEASING.md](C:/projects/hellscript/codex%20version/docs/RELEASING.md)
- Architecture: [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)

## See It in a Real App

[pet-shop](pet-shop) is a complete shop with a real API and server rendering, in about 1,300 lines without a single `cell`, `get`, `set`, `effect`, or `memo`. What building it found is in [docs/PET-SHOP.md](docs/PET-SHOP.md).

## Project Structure

The active structure is now split by responsibility:

- [src/demo](C:/projects/hellscript/codex%20version/src/demo)
  - demo app, pages, data, entry points, styles
- [src/framework/compiler](C:/projects/hellscript/codex%20version/src/framework/compiler)
  - AST transform and compiler metrics
- [src/framework/runtime](C:/projects/hellscript/codex%20version/src/framework/runtime)
  - client runtime, DOM, hydration, router, slots
- [src/framework/server](C:/projects/hellscript/codex%20version/src/framework/server)
  - SSR runtime, router, string renderer
- [src/framework/package](C:/projects/hellscript/codex%20version/src/framework/package)
  - package entry points for external projects

Active framework entry points are:

- [src/framework/compiler/plugin.ts](C:/projects/hellscript/codex%20version/src/framework/compiler/plugin.ts)
- [src/framework/runtime/index.ts](C:/projects/hellscript/codex%20version/src/framework/runtime/index.ts)
- [src/framework/server/index.ts](C:/projects/hellscript/codex%20version/src/framework/server/index.ts)
- [src/framework/package/runtime.ts](C:/projects/hellscript/codex%20version/src/framework/package/runtime.ts)
- [src/framework/package/server.ts](C:/projects/hellscript/codex%20version/src/framework/package/server.ts)
- [src/framework/package/vite.ts](C:/projects/hellscript/codex%20version/src/framework/package/vite.ts)

The only files intentionally left flat in `src/framework` are:

- [shared.ts](C:/projects/hellscript/codex%20version/src/framework/shared.ts)
- [jsx.d.ts](C:/projects/hellscript/codex%20version/src/framework/jsx.d.ts)
- [react-bench-modules.d.ts](C:/projects/hellscript/codex%20version/src/framework/react-bench-modules.d.ts)

## Running the Project

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

Useful verification commands:

```bash
npm run typecheck
npm run build
npm run build:package
npm run release:check
npm run bench
npm run bench:runtime
```

`npm run build` now does three things:

- builds the client bundle
- builds the SSR bundle used for rendering
- fills `dist/index.html` with prerendered app HTML

In the dev server (`npm run dev`) the app mounts normally without handwritten demo HTML. In the build output, real prerendered markup is generated and then hydrated by the client.

`npm run bench` runs the current micro-benchmark harness through Vitest Bench for counter, table, and list paths, including local comparisons against naive direct DOM updates, Vue, and React. Solid is intentionally benchmarked through the runtime harness instead, because the direct Node + browser-condition setup is more reliable than the current Vitest path for Solid's client renderer.

`npm run bench:runtime` is the more robust runtime comparison outside Vitest. It uses fixed iterations and multiple rounds per scenario, runs the process with the `browser` condition for Solid, and writes results to `bench-runtime-results.json`.

## Using Hel as a Package

The repo build and the package build are intentionally separate:

- `npm run build` builds the demo, SSR, and prerender output
- `npm run build:package` builds the consumable package artifacts into `dist/package`

The current package entry points are:

- `hel` or `hel/runtime`
- `hel/server`
- `hel/vite`

For a local install in another project, the current flow is for example:

```bash
# in the Hel repo
npm install
npm run build:package

# in the other project
npm install ../hel
```

Example imports:

```ts
import { mount, h } from "hel";
import { renderToString } from "hel/server";
import { helMagicPlugin } from "hel/vite";
```

Verified external consumers live in this repo as well:

- [starter](C:/projects/hellscript/codex%20version/starter)
- [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)

Those starters are built and typechecked as separate projects instead of relying on internal source aliases.

`starter` is the smallest client-only consumer.

`starter-ssr` shows the current SSR path as an external project:

- `hel/runtime` in the client build
- `hel/server` in the SSR build
- a prerender step via a small `entry-server.tsx`

Important for external SSR consumers:

- client code still imports from `hel/runtime`
- the SSR build must alias `hel/runtime` to `hel/server`
- that wiring is already shown in [starter-ssr/vite.config.ts](C:/projects/hellscript/codex%20version/starter-ssr/vite.config.ts)

For fast package verification there are now two scripts:

```bash
npm run verify:package
```

This builds the package and then validates both external consumers (`starter` and `starter-ssr`) against the published package surface.

If the package has already been built, this is enough:

```bash
npm run verify:starters
```

Important notes:

- the package build is currently ESM-only
- `npm run build:package` should run before local installation
- the repo is not a final release candidate yet, but the package structure is now consumable

## How to Use It

### 1. Write components in PascalCase

```tsx
export function Counter() {
  let count = 0;

  function increment() {
    count++;
  }

  return <button onClick={increment}>Count: {count}</button>;
}
```

Currently supported:

- `function Counter() {}`
- `const Counter = () => {}`
- `const Counter = function () {}`

The compiler only transforms components with PascalCase names.

### 2. `let` is reactive local state

Everything declared as `let` in component scope is treated as mutable reactive cell state.

```tsx
export function Counter() {
  let count = 0;
  let step = 1;

  function increment() {
    count += step;
  }

  return (
    <>
      <button onClick={increment}>Count: {count}</button>
      <button onClick={() => (step = step === 1 ? 2 : 1)}>Step: {step}</button>
    </>
  );
}
```

Also supported:

- `count = 1`
- `count += 2`
- `count ||= 1`
- `count ??= 1`
- `count++`, `count--`

Not supported in the current state:

- destructuring for reactive `let` declarations
- default and rest parameters on components

Both fail with a clear compiler error.

Destructured props stay reactive, in the parameter list and in the body:

```tsx
function TodoCard({ todo }) {
  return <article>{todo.title}</article>;
}
```

### 3. Normal helper functions work

You can write normal local functions or `const` arrow functions. A call in JSX always gets a slot, and the runtime finds what it actually reads.

```tsx
export function Counter() {
  let count = 0;

  function isEven() {
    return count % 2 === 0;
  }

  function label() {
    return isEven() ? "Even" : "Odd";
  }

  const summary = () => `${count} clicks`;

  return (
    <>
      <p>{label()}</p>
      <p>{summary()}</p>
    </>
  );
}
```

That is an important difference from simpler approaches that only make direct JSX reads reactive.

### 4. `const` stays up to date

A top-level `const` that might read state is a derived value. It is computed once per change, however often it is read.

```tsx
let count = 0;

const doubled = count * 2;
const label = format(count);
const initial = untrack(() => count); // an explicit snapshot
```

`store(...)`, `new ...`, `use*(...)`, and `create*(...)` are not re-run when their arguments change. See [REACTIVITY.md](docs/REACTIVITY.md) for the exact rules.

### 5. JSX stays direct and VDOM-free

```tsx
return (
  <main>
    <button disabled={count === 0} onClick={() => (count = 0)}>
      Reset
    </button>
    {count > 0 ? <p>{count}</p> : <p>empty</p>}
  </main>
);
```

The compiler turns this into direct DOM calls and specialized slots for:

- text
- attributes and properties
- block content

### 6. Arrays and lists

Normal arrays and `map(...)` already work:

```tsx
<ul>
  {todos.map((todo) => (
    <li>{todo.title}</li>
  ))}
</ul>
```

That is the current **unkeyed** list variant. It is fine for simple cases, but it replaces things more coarsely on structural changes.

If you want stable keys and DOM reuse on reorder, use the explicit `list(...)` API:

```tsx
import { list } from "hel/runtime";

<ul>
  {list(
    () => todos,
    (todo) => todo.id,
    (todo) => <li>{todo.title}</li>,
  )}
</ul>
```

Current `list(...)` semantics:

- keyed DOM reuse on reorder
- SSR and hydration compatible
- each item must render exactly **one** root node
- intentionally still a runtime API, not compiler magic

Pragmatically this means:

- `map(...)` for simple lists
- `list(...)` for stable keyed lists
- optional `For` as a control-flow helper over both styles

```tsx
import { For } from "hel/runtime";

<ul>
  <For each={todos} key={(todo) => todo.id}>
    {(todo) => <li>{todo.title}</li>}
  </For>
</ul>
```

Without `key`, `For` simply renders through `map(...)`. With `key`, it uses keyed `list(...)` semantics internally.

`For` can also render an empty state directly:

```tsx
<For each={todos} fallback={<p>No todos yet.</p>}>
  {(todo) => <TodoRow todo={todo} />}
</For>
```

For branches there is also optional `Show`:

```tsx
import { Show } from "hel/runtime";

<Show when={visible} fallback={<p>Hidden</p>}>
  <section>Visible</section>
</Show>
```

Normal ternaries in JSX remain the default as well:

```tsx
{visible ? <Panel /> : <Empty />}
```

### 7. Form inputs and todos

Controlled inputs already work with normal events and `let` state:

```tsx
let newTitle = "";
let todos = [{ id: "a", title: "Ship Hel", done: false }];

const remainingTodos = () => todos.filter((todo) => !todo.done).length;

function addTodo(event: Event) {
  event.preventDefault();
  todos = [...todos, { id: crypto.randomUUID(), title: newTitle, done: false }];
  newTitle = "";
}
```

The current style is intentionally simple:

- `todos = [...todos, next]`
- `todos = todos.map(...)`
- `todos = todos.filter(...)`
- or a local proxy store with mutations

A deeper official store with a setter API like `setTodos(i, "done", true)` is still intentionally not part of core.

### 8. Minimal deep store

For arrays and objects there is also a small proxy store:

```tsx
import { store } from "hel/runtime";

const todos = store([
  { title: "Ship Hel", done: false },
]);

todos.push({ title: "Benchmark runtime", done: true });
todos[0].done = true;
todos[0].title = "Ship Hel v0.1";
```

Important semantics:

- proxy-based, with each property tracked separately
- deep property and array mutations trigger reactivity
- works in a component and at module level
- `Date` and `Map` values are not supported yet

### 9. HTML-first router

The current router is intentionally small:

```tsx
import { createRouter } from "hel/runtime";

const router = createRouter([
  { path: "/", view: () => <Home /> },
  { path: "/todos/:id", view: () => <TodoDetail id={router.params().id} /> },
  { path: "/about", view: () => <About /> },
]);

return (
  <>
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
    </nav>
    {router.view()}
  </>
);
```

Important semantics:

- normal `<a href>` tags are the default
- the router only intercepts internal links that it knows about
- external links, modifier keys, and `target` keep normal browser behavior
- `router.view()` returns a renderable block directly
- the page is only rebuilt when the matched route changes, or something the view reads in its own body, so `<TodoDetail id={router.params().id} />` keeps its state and focus
- `router.isActive("/about")` can be used directly in props
- `router.params()` returns route params for the currently matched path
- `router.query()` returns current query params as a plain object
- `router.navigate(-1)` and `router.navigate(1)` delegate to browser history
- JSX components with reactive props are stable again in the current compiler path, including form subtrees

Example for params:

```tsx
const router = createRouter([
  { path: "/todos", view: () => <Todos /> },
  { path: "/todos/:id", view: () => <TodoDetail id={router.params().id} /> },
]);
```

Example for query params:

```tsx
const router = createRouter([
  { path: "/todos", view: () => <Todos filter={router.query().filter ?? "all"} /> },
]);
```

Example for history convenience:

```tsx
<button type="button" onClick={() => router.navigate(-1)}>
  Back
</button>
```

Example:

```tsx
<a href="/about" data-active={router.isActive("/about")}>
  About
</a>
```

Intentionally not included yet:

- nested routes
- guards
- loaders or actions

### 10. Minimal context

Hel now has a small context API for shared subtree state.

```tsx
import { createContext, useContext } from "hel/runtime";

const AuthContext = createContext({ role: "guest" });

function RoleBadge() {
  const auth = useContext(AuthContext);
  return <strong>{auth.role}</strong>;
}

<AuthContext.Provider value={{ role: "admin" }}>
  <RoleBadge />
</AuthContext.Provider>
```

Current context semantics:

- works on client and server
- rerenders the provider subtree when the provider value changes
- good fit for auth, theme, and app-shell state
- intentionally small, not a full dependency-injection layer

### 11. Sharing logic with `use*` functions

Functions named `use*` are compiled like components, also in plain `.ts` files.

```ts
export function useCart() {
  let items: CartItem[] = [];
  const total = items.reduce((sum, item) => sum + item.price, 0);

  function add(item: CartItem) {
    items = [...items, item];
  }

  return { items, total, add };
}

export const cart = useCart(); // a shared instance
```

```tsx
function CartBadge() {
  return <a href="/cart">{cart.items.length} items, {cart.total} €</a>;
}
```

Reactive values in the returned object become getters. Returning a reactive value directly or in an array is a compile error, because it would be frozen.

### 12. Loading data

```tsx
function PetPage(props) {
  const pet = useResource(() => `/api/pets/${props.id}`, getJson);

  return pet.loading ? <Spinner /> : <PetDetails pet={pet.value} />;
}
```

The first function is tracked and identifies the data. The second one is not, and it gets an `AbortSignal`. When the source changes, the old request is aborted and its response ignored. Reading `value` throws if the request failed, unless you check `error` first, so a failure cannot look like empty data.

There is no cache. On the server it never fetches, see [SSR-HYDRATION.md](docs/SSR-HYDRATION.md). An `async` component is a compile error.

### 13. Handling errors

```tsx
<ErrorBoundary fallback={(error, retry) => <Oops error={error} onRetry={retry} />}>
  <PetPage id={id} />
</ErrorBoundary>
```

It catches component setup, slots, keyed rows, effects, `onMount`, and failed resources, also during SSR and hydration. Event handlers stay with the browser.

Without a boundary, the error goes to `reportError`. A block or text slot that failed shows nothing until its next change, when it tries again.

## What Internally Becomes What

The user-facing API is intentionally magical. Internally it still lands on a small runtime.

### `let` becomes a cell

User code:

```tsx
let count = 0;
count++;
```

Internal direction:

```ts
const __cell_count_0 = __cell(0);
__set(__cell_count_0, __get(__cell_count_0) + 1);
```

In practice that is conceptually a hidden `signal()` or `ref()`, just with a different runtime shape.

### Reads become `get(...)`

User code:

```tsx
<p>{count}</p>
```

Internal direction:

```ts
__h("p", null, __dynText(() => __get(__cell_count_0)));
```

### Writes become `set(...)`

User code:

```tsx
count = 10;
count += step;
```

Internal direction:

```ts
__set(__cell_count_0, 10);
__set(__cell_count_0, __get(__cell_count_0) + __get(__cell_step_1));
```

### Text expressions become slot effects

User code:

```tsx
<p>{count}</p>
```

Internal direction:

```ts
__dynText(() => __get(__cell_count_0))
```

Runtime semantics:

- creates exactly one text node
- registers one `effect(...)`
- later patches only `text.data`

Behaviorally that is similar to a very small implicit `effect` plus text binding.

### Dynamic props become attribute and property slots

User code:

```tsx
<button disabled={count === 0}>Reset</button>
```

Internal direction:

```ts
__h("button", {
  disabled: __dynAttr(() => __get(__cell_count_0) === 0)
})
```

Runtime semantics:

- registers one `effect(...)`
- later patches only the relevant attribute or property

### Dynamic blocks become block slots

User code:

```tsx
{visible ? <Panel /> : <Empty />}
```

Internal direction:

```ts
__branch(() => __get(__cell_visible_0), () => __h(Panel, null), () => __h(Empty, null))
```

Runtime semantics:

- marks one DOM range
- only replaces that range, not the entire parent

## What maps to `signal`, `effect`, `memo`?

In short:

| User-code idea | Internal equivalent in the current prototype |
| --- | --- |
| `let count = 0` | `cell(0)` |
| read `count` | `get(cell)` |
| `count = ...`, `count++` | `set(cell, ...)` |
| `{count}` in JSX | `dynText(() => get(cell))` plus internal `effect(...)` |
| `disabled={count === 0}` | `dynAttr(() => ...)` plus internal `effect(...)` |
| `{visible ? <A/> : <B/>}` | specialized `branch(...)` slot plus internal `effect(...)` |
| `const helper = () => count * 2` | normal helper that reads `get(cell)` when called |
| `const doubled = count * 2` | `memo(() => get(cell) * 2)` |

Important:

- there is no explicit `signal()` in user code
- there is no explicit `effect()` in user code
- there is no explicit `memo()` in user code either
- the runtime implicitly takes the role of `effect()` per slot
- compiler-generated `cell/get/set` takes the role of `signal()`
- compiler-generated `memo` takes the role of `memo()` for derived `const` values

## Current Performance Characteristics

The current state already does a few important things:

- fine-grained subscription tracking in the runtime
- a microtask scheduler instead of synchronous cascade updates
- text slots patch only text nodes
- attr slots patch only the relevant attribute or property
- only real structural changes go through block slots
- conditional toggles use specialized branch slots
- keyed `list(...)` can reuse DOM nodes on reorder
- no virtual DOM

Still missing:

- optimized template-cloning paths for dynamic subtrees

## Current Limits

- Components are PascalCase functions, anonymous default exports containing JSX, or functions containing JSX passed to a call.
- Only top-level `let` and `const` in components and `use*` functions are transformed.
- Destructuring for reactive `let` is not implemented yet.
- A module-level `let` is not reactive, and the compiler warns when JSX reads one.
- Hydration covers the intended path and mismatch fallback, but not every structural edge case.
- Reads after an `await` are not tracked, and `onCleanup` and `useContext` do not work there.
- `list(...)` and keyed `For` are the official keyed story. There is no automatic keyed compiler detection.

## Relevant Files

- `src/framework/compiler/plugin.ts`: AST transform for components, `use*` functions, `let`, derived `const`, and JSX slots
- `src/framework/compiler/metrics.ts`: compiler metrics for transform output
- `src/framework/runtime/index.ts`: public runtime API and DOM entry points
- `src/framework/runtime/*`: split runtime for core, DOM, patching, slots, router, and hydration
- `src/framework/server/index.ts`: public SSR API
- `src/framework/server/*`: split server renderer and SSR router
- `src/framework/package/*`: package entry points for runtime, SSR, and Vite plugin
- `scripts/build-package.mjs`: JS build for publishable package artifacts
- `tsconfig.package.json`: declaration build for package types
- `src/demo/App.tsx`: demo app with router, store, and todo workspace
- `src/demo/pages/*`: split demo pages
- `src/demo/components/*`: reusable demo building blocks
- `docs/M2-DESIGN.md`: architecture and next steps toward hydration and SSR
