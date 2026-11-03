# Reactivity Model

This document explains the reactivity semantics in `Hel`. The reasoning behind them is in [DESIGN-DECISIONS.md](DESIGN-DECISIONS.md).

The short version is:

- write normal components
- use `let` for state
- derive values with plain `const` or functions
- share logic with `use*` functions

One rule sits behind all of this: code either updates or fails loudly. It never stays silently stale.

## Core Rules

Inside a component or a `use*` function:

- a top-level `let` is reactive state
- a top-level `const` that reads state stays up to date
- nested functions and handlers are normal JavaScript

```tsx
function Counter() {
  let count = 0;
  const doubled = count * 2;

  return (
    <>
      <button onClick={() => count++}>Count: {count}</button>
      <p>Double: {doubled}</p>
    </>
  );
}
```

## What Counts as Reactive

The compiler cannot see across modules, so anything that might read state gets a slot, and the runtime finds the real dependencies.

| Expression in JSX | Result |
| --- | --- |
| Literal, function, event handler, `ref` | static |
| Identifier bound to a `let`, a derived `const`, or a prop alias | slot |
| Any other identifier | static |
| Contains a member read or a call | slot |
| Compound of static parts only | static |

That means all of these update:

```tsx
<p>{cart.total}</p>            // a store or hook result from another module
<p>{auth.role}</p>             // a store from useContext
<p>{formatPrice(item)}</p>     // a helper that reads state
```

A slot that read nothing on its first run can never run again, so it costs little and leaves nothing to clean up.

A slot can hold text or renderable content. `{props.children}` and helpers that return elements both work.

## `const` Semantics

A `const` follows the same rule as a JSX expression: if the initializer might read state, the value stays up to date.

```tsx
let count = 0;

const doubled = count * 2;       // computed once per change
const label = format(count);     // computed once per change, not once per read
const title = props.title;       // re-reads the prop
const { name } = props;          // re-reads the prop
const factor = 2;                // plain
const element = <i>{count}</i>;  // created once where it is first read
```

Handlers see the fresh value right after a write:

```tsx
<button onClick={() => { count = 5; console.log(doubled); }} />  // logs 10
```

These always stay plain, because re-running them would lose what they created:

- functions
- `store(...)`, `new ...`, `use*(...)`, `create*(...)`
- `untrack(...)`, `memo(...)`, `list(...)`, `ref(...)`, `effect(...)`, `cell(...)`

For an explicit snapshot, use `untrack`:

```tsx
const initial = untrack(() => count);
```

### What to watch for

- An initializer with side effects runs again when its dependencies change.
- An object from a derived `const` gets a new identity when its dependencies change.
- A `const` can change between two reads, so TypeScript narrowing across an `await` may not hold.
- A value that does not change still notifies dependents, which then compare or re-render.

## Sharing Logic

A function named `use*` is compiled the same way as a component, also in plain `.ts` files.

```ts
export function useCart() {
  let items: CartItem[] = [];
  const total = items.reduce((sum, item) => sum + item.price, 0);

  function add(item: CartItem) {
    items = [...items, item];
  }

  return { items, total, add };
}
```

- Reactive values in a returned object literal become getters.
- Writing through such a property throws a `TypeError`. Change state through functions.
- Returning a reactive value directly, or inside an array, is a compile error, because it would be frozen.
- `const { total, add } = useCart()` keeps working, the same as destructured props.
- Arguments are evaluated once. For live input, pass a function: `useUser(() => props.id)`.

### Shared state

A single instance at module level is shared across components:

```ts
export const cart = useCart();
```

A `store(...)` at module level works as well. A module-level `let` stays a normal variable, because importers cannot be rewritten. The compiler warns when JSX reads one.

## What Counts as a Component

- functions with a PascalCase name
- anonymous default exports containing JSX
- functions containing JSX passed to a call: `const Name = wrap(() => <div />)`

A component body runs once and does not subscribe to what it reads, wherever it is mounted. Only slots update.

## Slot Model

The runtime does not use a virtual DOM. It installs fine-grained slot updates.

- **Text slot** `<p>{count}</p>`: keeps a text node and patches its data.
- **Attribute slot** `<button disabled={count === 0} />`: patches one attribute or property.
- **Block slot** `{items.map(...)}`: manages one DOM range.
- **Branch slot** `{visible ? <Panel /> : <Empty />}`: re-renders only when the branch changes.

### Hidden branches

A branch that is hidden is disposed, whether it was written with a ternary, `&&`, or `<Show>`. `onCleanup` runs, its effects stop, and it starts with fresh local state when shown again. To keep state across a toggle, keep it above the branch.

## `For`, `Show`, and Lists

```tsx
<For each={todos} key={(todo) => todo.id}>
  {(todo) => <TodoRow todo={todo} />}
</For>
```

- without `key`: an unkeyed block that re-renders
- with `key`: nodes and row state move with their key

A keyed row stays alive when its key brings a new object, for example after a refetch. The compiler rewrites its parameters so they read the current value, like props, so its `let` state and focus survive and only the slots that read a changed value update. A row is rendered again only if its function reads the item directly in its own body:

```tsx
<For each={pets} key={(pet) => pet.id}>
  {(pet) => {
    const label = pet.name.toUpperCase(); // read here, so this row renders again
    return <li>{label}</li>;
  }}
</For>
```

The same happens when the compiler cannot rewrite a parameter safely, such as with a default value in a destructuring pattern.

```tsx
<Show when={selected} fallback={<Empty />}>
  <Inspector />
</Show>
```

`Show` is a branch slot. It re-renders only when the condition flips between truthy and falsy.

## Store Model

`store(...)` is available for objects and arrays:

```tsx
const todos = store([{ title: "Ship Hel", done: false }]);

todos[0].done = true;
todos.push({ title: "Write docs", done: false });
```

It is proxy-based and tracks each property separately. `Date` and `Map` values are not supported yet.

## Async Data and Errors

`useResource(source, fetcher)` loads data. Only `source` is tracked, so whatever identifies the data belongs there. See [ASYNC-AND-ERRORS.md](ASYNC-AND-ERRORS.md) for the reasoning.

A slot that throws goes to the nearest `<ErrorBoundary>`. Without one, the error goes to `reportError`, and until its next change the slot shows nothing, because its content is disposed. An attribute keeps its last value, since removing `disabled` or `class` could be worse. The slot tries again on its next change.

## Scheduler Model

- writes schedule effects
- effects flush in a microtask
- repeated writes within one tick are coalesced
- derived values are invalidated synchronously and recompute when read
- an effect that throws goes to the nearest `<ErrorBoundary>` or to `reportError`, and the others still run
- effects that keep triggering each other are stopped after 100 cycles with an error

## Relation to `signal`, `effect`, and `memo`

These exist internally. User code should rarely need them.

| Concept | Hel equivalent |
| --- | --- |
| `signal()` | `let`, compiled to `cell(...)` |
| reading a signal | reading the variable, compiled to `get(cell)` |
| writing a signal | assigning the variable, compiled to `set(cell, next)` |
| `effect()` | slot effects installed by the runtime |
| `memo()` | a `const` that reads state, compiled to `memo(...)` |

## Current Constraints

- reactive `let` destructuring is not supported
- component parameters must be a plain identifier or an object pattern
- only top-level `let` and `const` are transformed
- an async component or `use*` function is a compile error. Use `useResource`
- reads after an `await` are not tracked, and `onCleanup` and `useContext` do not work there

## Recommended Reading Order

1. [GETTING-STARTED.md](GETTING-STARTED.md)
2. [API-REFERENCE.md](API-REFERENCE.md)
3. [SSR-HYDRATION.md](SSR-HYDRATION.md)
4. [DESIGN-DECISIONS.md](DESIGN-DECISIONS.md)
