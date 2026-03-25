# Reactivity Model

This document explains the current reactivity semantics in `Hel`.

The short version is:

- write normal components
- use `let` for local mutable state
- use normal functions for derived reads
- let the compiler and runtime handle the slot wiring

## Core Rule

Inside a component:

- `let` is reactive
- `const` is normal TypeScript

Example:

```tsx
function Counter() {
  let count = 0;
  const doubled = () => count * 2;

  return (
    <>
      <button onClick={() => count++}>Count: {count}</button>
      <p>Double: {doubled()}</p>
    </>
  );
}
```

That is the intended default programming model.

## What the Compiler Does

### Reactive `let`

This:

```tsx
let count = 0;
count++;
```

is compiled in the direction of:

```ts
const __cell_count_0 = __cell(0);
__set(__cell_count_0, __get(__cell_count_0) + 1);
```

So conceptually:

- `let` becomes a hidden cell
- reads become `get(...)`
- writes become `set(...)`

### Normal helpers

This:

```tsx
const label = () => `${count} clicks`;
```

stays a normal function.

What changes is that the compiler knows the function reads reactive state, so when it is used in JSX:

```tsx
<p>{label()}</p>
```

it becomes a reactive slot update instead of a one-time static expression.

## What Counts as Reactive

Reactive today:

- local `let` bindings inside components
- reads from `store(...)` values
- local helper functions that directly or transitively read those bindings

Not automatically reactive today:

- plain `const` values that are calculated once
- arbitrary module-level mutable state
- arbitrary foreign objects

## `const` Semantics

This works:

```tsx
const factor = 2;
const doubled = () => count * factor;
```

This does not become a computed value:

```tsx
const doubled = count * 2;
```

That is just a normal expression evaluated at render time.

Current stance:

- `const` helpers are good
- implicit computed caching is not part of the model yet

## Slot Model

The runtime does not use a virtual DOM. Instead it installs fine-grained slot updates.

Current slot categories:

- text slots
- attribute/property slots
- block slots
- specialized branch slots

### Text slot

```tsx
<p>{count}</p>
```

The runtime keeps a text node and later patches only its text data.

### Attribute slot

```tsx
<button disabled={count === 0}>Reset</button>
```

The runtime later patches only the affected attribute or property.

### Block slot

```tsx
{visible ? <Panel /> : <Empty />}
```

The runtime manages only the DOM range for that branch, not the entire parent subtree.

### Branch slot

Conditionals are now compiled through a specialized branch path instead of always falling back to a generic dynamic block.

That matters because:

- it preserves branch structure better
- it improves toggle performance
- it makes branch retention possible in hot paths

## `For`, `Show`, and Lists

`For` and `Show` do not introduce a second reactivity model. They sit on top of the same runtime slot mechanics.

### `For`

```tsx
<For each={todos} key={(todo) => todo.id}>
  {(todo) => <TodoRow todo={todo} />}
</For>
```

- without `key`: behaves like an unkeyed list
- with `key`: uses keyed list semantics

### `Show`

```tsx
<Show when={selected} fallback={<Empty />}>
  <Inspector />
</Show>
```

- small convenience helper
- not a second effect system

## Store Model

`store(...)` is available for local objects and arrays:

```tsx
const todos = store([
  { title: "Ship Hel", done: false },
]);

todos[0].done = true;
todos.push({ title: "Write docs", done: false });
```

Current semantics:

- proxy-based
- local
- intentionally coarse-grained per store

This is deliberately not trying to be the full Solid store model.

That means:

- good enough for local app data
- not yet a final answer for deep, large, cross-cutting state orchestration

## Scheduler Model

Updates are not run synchronously one by one like a naive effect cascade.

Current behavior:

- writes schedule effects
- effects flush through a microtask-based scheduler
- repeated writes within the same tick are coalesced where possible

Practical consequence:

- fewer redundant reruns
- more stable DOM update batches

## What This Means for User Code

Preferred style:

```tsx
function App() {
  let count = 0;
  const label = () => `${count} clicks`;

  return <button onClick={() => count++}>{label()}</button>;
}
```

Also acceptable:

```tsx
const state = store({ count: 0 });
const label = () => `${state.count} clicks`;
```

What to avoid expecting:

```tsx
const label = `${count} clicks`;
```

That is not a tracked derived value.

## Current Constraints

The following are real constraints of the current model:

- only PascalCase components are transformed
- reactive `let` destructuring is not supported
- component parameters must currently be a simple identifier
- helper analysis is intentionally local and conservative
- `store(...)` is intentionally coarse-grained

## Relation to `signal`, `effect`, and `memo`

Hel does not expose those APIs as the primary user model, but internally there are close equivalents:

| Concept | Current Hel equivalent |
| --- | --- |
| `signal()` | compiler-generated `cell(...)` |
| reading a signal | `get(cell)` |
| writing a signal | `set(cell, next)` |
| `effect()` | internal slot effect installed by the runtime |
| `memo()` | no direct equivalent yet |

That is why the mental model should be:

- hidden cells
- explicit compiler wiring
- implicit runtime slot effects

not:

- user-authored reactive primitives everywhere

## Recommended Reading Order

1. [GETTING-STARTED.md](C:/projects/hellscript/codex%20version/docs/GETTING-STARTED.md)
2. [API-REFERENCE.md](C:/projects/hellscript/codex%20version/docs/API-REFERENCE.md)
3. [SSR-HYDRATION.md](C:/projects/hellscript/codex%20version/docs/SSR-HYDRATION.md)
4. [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
