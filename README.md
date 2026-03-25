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

`npm run bench` runs the current micro-benchmark harness through Vitest Bench for counter, table, and list paths, including local comparisons against naive direct DOM updates, Vue, and React. A reliable Solid baseline is still open in the current Vitest and happy-dom setup.

`npm run bench:runtime` is the more robust runtime comparison outside Vitest. It uses fixed iterations and multiple rounds per scenario and writes results to `bench-runtime-results.json`.

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
- component parameters that are not a simple identifier

For reactive `let` destructuring, the compiler now throws a clear error instead of silently producing broken code.

The same applies to this pattern for now:

```tsx
function TodoCard({ todo }) {
  return <article>{todo.title}</article>;
}
```

At the moment you should accept a `props` identifier and destructure inside the function instead:

```tsx
function TodoCard(props) {
  const { todo } = props;
  return <article>{todo.title}</article>;
}
```

Default parameters and rest parameters for components are also intentionally blocked with a clear compiler error in the current state.

### 3. Normal helper functions work

You can write normal local functions or `const` arrow functions. If they read reactive `let` bindings, the compiler detects that and wires the call into a reactive slot.

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

### 4. `const` stays normal TypeScript

`const` is not rewritten into state.

```tsx
const factor = 2;
const doubled = () => count * factor;
```

This works because `doubled()` reads reactive state when it executes.

What does **not** happen at the moment:

```tsx
const doubled = count * 2;
```

This does **not** become a cached `memo` or `computed`. It is simply a normal expression evaluated at render time.

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

- intentionally coarse-grained per store
- deep property and array mutations trigger reactivity
- no fine-grained property dependency graph like Solid stores
- good enough for small to medium local data structures

The compiler recognizes `store(...)` reads in JSX and local helper functions as reactive dependencies.

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
| `memo(() => count * 2)` | currently **no direct counterpart** |

Important:

- there is no explicit `signal()` in user code
- there is no explicit `effect()` in user code
- there is no explicit `memo()` in user code either
- the runtime implicitly takes the role of `effect()` per slot
- compiler-generated `cell/get/set` takes the role of `signal()`
- for `memo()` there is currently only the pragmatic form of a normal helper recalculated when needed

That means a helper like

```tsx
const doubled = () => count * 2;
```

is semantically closer to an **uncached derived getter** than to a true `memo`.

## Current Performance Characteristics

The current state already does a few important things:

- fine-grained subscription tracking in the runtime
- a microtask scheduler instead of synchronous cascade updates
- text slots patch only text nodes
- attr slots patch only the relevant attribute or property
- only real structural changes go through block slots
- conditional toggles in the hot path use specialized branch slots instead of generic `dynBlock(...)`
- keyed `list(...)` can reuse DOM nodes on reorder
- no virtual DOM

Still missing:

- cached derived values or a true `memo`
- optimized template-cloning paths for static subtrees

## Current Limits

- Only PascalCase components are transformed.
- Only `let` becomes automatic reactive state.
- Destructuring for reactive `let` is not implemented yet.
- Local function analysis is intentionally conservative and intra-component only.
- Hydration currently covers the intended happy path and mismatch fallback, but not every structural edge case.
- The built-in `store(...)` is intentionally coarse-grained and local.
- `list(...)` is still the official keyed story; automatic keyed compiler detection does not exist yet.

## Relevant Files

- `src/framework/compiler/plugin.ts`: AST transform for components, `let`, helper analysis, and JSX slots
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
