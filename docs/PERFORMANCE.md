# Performance Guide

This document describes the current performance model and benchmark posture of `Hel`.

The right expectation is:

- not Solid-level
- clearly faster than naive rendering on important paths
- predictable, compiler-driven DOM work

It is not:

- a finished performance story
- a claim that every path beats every competitor

## Current Strategy

`Hel` gets most of its performance from three decisions:

1. no virtual DOM
2. compiler-driven slot updates
3. narrow runtime patching instead of broad rerenders

In practice that means:

- text updates patch text nodes
- attribute updates patch only the relevant attribute or property
- conditional branches use specialized branch slots
- keyed lists can reuse DOM nodes on reorder

## Current Hot Paths

The most representative benchmark scenarios in this repo are:

- counter update
- table update
- list toggle update

These are tracked in:

- [bench-runtime-results.json](C:/projects/hellscript/codex%20version/bench-runtime-results.json)
- [bench-runtime.ts](C:/projects/hellscript/codex%20version/scripts/bench-runtime.ts)

## Current Runtime Bench Snapshot

The current benchmark snapshot in the repo reports approximately:

### Counter update

- Hel: `29507 hz`
- naive DOM: `23767 hz`
- Vue: `10320 hz`
- React: `6159 hz`

### Table update

- Hel: `273.5 hz`
- naive DOM: `242.0 hz`
- Vue: `245.7 hz`
- React: `138.2 hz`

### List toggle update

- Hel: `1177.0 hz`
- naive DOM: `1233.9 hz`
- Vue: `845.7 hz`
- React: `403.4 hz`

Interpretation:

- counter updates are already very strong
- table updates are in a good range
- list toggles were the key hot spot and are now close to naive DOM

## Why Those Results Look Like This

### Counter updates

These are the easiest wins for the architecture:

- one local `let`
- one text slot
- one button event

That lets Hel stay very close to the minimum useful amount of work.

### Table updates

These depend on:

- keyed lists
- stable DOM reuse
- in-place patching

This path improved once keyed list placement and in-place patching stopped doing unnecessary reinserts and replacements.

### List toggles

This used to be a weak point because broad `dynBlock(...)` behavior was too expensive for branch flips.

The major improvement came from:

- branch retention for expensive marker-based branches
- specialized branch slots instead of generic block handling for conditionals

That is why this path moved from an obvious weakness to something close to naive DOM and clearly ahead of Vue and React in the current harness.

## What the Compiler Already Optimizes

### Static subtree detection

Static JSX can be compiled through template-oriented paths instead of always rebuilding node-by-node.

### Specialized text and attribute bindings

Simple direct cell reads can compile to narrower helpers such as:

- `text(...)`
- `attr(...)`

instead of always going through broader closure-based wrappers.

### Specialized branch handling

Reactive conditionals now compile to a dedicated branch path instead of treating every conditional like a generic dynamic block.

## What the Runtime Already Optimizes

### Microtask scheduling

Effects are batched through a microtask scheduler.

That reduces:

- synchronous update cascades
- redundant reruns in the same tick

### Narrow DOM mutations

The runtime keeps statistics for:

- inserts
- removals
- replacements
- text patches
- attribute patches
- in-place patches

That instrumentation exists to keep optimization work honest.

### Stable list reuse

For keyed list paths, Hel tries to:

- reuse DOM nodes
- avoid unnecessary reinserts
- patch in place where structure is stable

## What Still Needs Work

The performance story is materially better now, but not finished.

Still open:

- more reduction of unnecessary `dyn*` wrappers
- closure allocation reduction in compiled output
- broader benchmark coverage
- memory and hydration budgets
- a reliable Solid baseline in a compatible harness

## How to Benchmark

### Quick benchmark

```bash
npm run bench
```

Useful for:

- quick local comparisons
- rapid feedback while iterating

Less useful for:

- strong absolute claims
- noisy slow-path decisions

### Runtime benchmark

```bash
npm run bench:runtime
```

This is the stronger benchmark path in this repo.

It:

- runs outside Vitest Bench
- uses fixed iterations
- runs multiple rounds
- writes results to `bench-runtime-results.json`

## How to Read the Numbers

- higher `hz` is better
- lower `meanMs` is better
- lower `rme` means the result is more stable

Only compare within the same scenario:

- compare `Hel table update` to `Vue table update`
- do not compare `Hel table update` to `Hel counter update`

## Practical Guidance for Writing Fast Hel Code

### Prefer normal local `let` state

That is the path the compiler understands best.

### Use normal helper functions

Helpers are fine. The compiler can track local helper reads.

### Use `list(...)` or keyed `For` when identity matters

For stable list reuse:

```tsx
<For each={todos} key={(todo) => todo.id}>
  {(todo) => <TodoRow todo={todo} />}
</For>
```

### Do not expect `const value = count * 2` to become a cached computed

If you need a derived read, use a helper:

```tsx
const doubled = () => count * 2;
```

### Keep router expectations realistic

The router is intentionally small and fast enough for the current scope, not a full data-router framework.

## Current Honest Summary

Today, `Hel` is strongest when:

- UI state is local
- DOM updates are narrow
- component structure is predictable
- branches and keyed lists align with the specialized compiler and runtime paths

It is not yet finished in:

- broad benchmark coverage
- performance budgeting
- final performance documentation for `1.0`

## Related Docs

1. [REACTIVITY.md](C:/projects/hellscript/codex%20version/docs/REACTIVITY.md)
2. [API-REFERENCE.md](C:/projects/hellscript/codex%20version/docs/API-REFERENCE.md)
3. [SSR-HYDRATION.md](C:/projects/hellscript/codex%20version/docs/SSR-HYDRATION.md)
4. [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
