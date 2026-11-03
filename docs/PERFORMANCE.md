# Performance Guide

This document describes the current performance model and benchmark posture of `Hel`.

The right expectation is:

- in the same group as Solid and Svelte in js-framework-benchmark, on one machine so far
- predictable, compiler-driven DOM work

It is not:

- a finished performance story
- a claim that every path beats every competitor

## js-framework-benchmark

Measured with the [Hel implementation in this repository](../benchmarks/js-framework-benchmark), which uses plain `let` state and no benchmark-specific tricks. Keyed mode, headless Chrome 149 on Windows, one developer machine. Two runs of 15 iterations each with the framework order reversed, pooled.

**This is not an official result.** Hel cannot join the official benchmark until it is published on npm. The score is the weighted geometric mean of the CPU benchmarks, using the official weights, relative to the fastest framework in this selection only. The official table has many more frameworks, so a rank here is not a rank there.

| | vanilla | Solid | **Hel** | Svelte | Vue | React |
|---|---|---|---|---|---|---|
| **Score** (lower is better) | 1.00 | 1.10 | **1.13** | 1.15 | 1.29 | 1.51 |
| Score, first run | 1.03 | 1.11 | 1.12 | 1.14 | 1.31 | 1.49 |
| Score, second run | 1.00 | 1.09 | 1.09 | 1.15 | 1.26 | 1.53 |
| Create 1,000 rows | 42.4 ms | 44.9 ms | **46.1 ms** | 46.3 ms | 55.7 ms | 57.6 ms |
| Replace 1,000 rows | 49.4 ms | 50.4 ms | **51.4 ms** | 57.5 ms | 59.3 ms | 65.3 ms |
| Update every 10th row | 28.9 ms | 30.9 ms | **39.0 ms** | 31.7 ms | 36.1 ms | 40.6 ms |
| Select a row | 10.3 ms | 12.7 ms | **12.3 ms** | 17.8 ms | 12.9 ms | 17.6 ms |
| Swap two rows | 32.0 ms | 35.0 ms | **37.2 ms** | 36.3 ms | 36.4 ms | 249.9 ms |
| Remove a row | 25.7 ms | 28.8 ms | **25.5 ms** | 25.9 ms | 36.7 ms | 28.6 ms |
| Create 10,000 rows | 453 ms | 498 ms | **522 ms** | 514 ms | 585 ms | 811 ms |
| Append 1,000 rows | 50.4 ms | 50.9 ms | **58.2 ms** | 59.2 ms | 59.3 ms | 63.4 ms |
| Clear rows | 19.5 ms | 27.1 ms | **22.1 ms** | 24.7 ms | 29.9 ms | 37.5 ms |
| Memory after creating 1,000 rows | 2.0 MB | 2.8 MB | **3.0 MB** | 3.0 MB | 4.0 MB | 4.6 MB |
| Size, compressed | 2.5 KB | 4.5 KB | **9.1 KB** | 9.7 KB | 23.3 KB | 51.4 KB |

How far to trust this:

- A framework's score moved by up to 0.1 between runs on this machine, more than the distance between Solid, Hel, and Svelte. An earlier state of Hel swapped places with Svelte between two runs. Hel beat Svelte in both final runs, but read this as one group of three, with Vue and React clearly behind.
- Hel's weakest points are updating every 10th row and the long tail of creating 10,000 rows: its fastest runs match Svelte, but its slowest reached about 1,050 ms against about 870 ms.
- Other browsers and machines are not measured.

Before this work, Hel scored 1.33 in this selection, behind Vue. Getting here took:

| Change | Why it mattered |
| --- | --- |
| Cloning whole element trees | Creating elements one by one was the largest cost. The compiler now describes a tree once per module and fills in the dynamic parts. Hydration and the server still go element by element, from the same description |
| Reusing text nodes from the template | No extra node to create and append for most slots |
| Moving only rows that left their order | Swapping two rows moved every row between them, which took 361 ms |
| Trimming both ends of a list change | Appending or removing rows needs no map and no sorting |
| One numeric tag per value | Rendering ran up to seven `in` checks per child |
| Delegating clicks | A listener per row costs twice: when added and when the row is removed |
| Lighter effects | No `Set` for a single subscriber or dependency, no closures for disposal, and no effect kept for a row that read nothing |
| Reading the key instead of a slot | `{row.id}` needs no slot when the key is `row.id`, because a row keeps its key for life |

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

- [bench-runtime-results.json](../bench-runtime-results.json)
- [bench-runtime.ts](../scripts/bench-runtime.ts)

## Current Runtime Bench Snapshot

The current benchmark snapshot in the repo reports approximately:

### Counter update

- Hel: `29507 hz`
- naive DOM: `23767 hz`
- Vue: `10320 hz`
- React: `6159 hz`
- Solid: `32631 hz`

### Table update

- Hel: `273.5 hz`
- naive DOM: `260.3 hz`
- Vue: `151.8 hz`
- React: `44.8 hz`
- Solid: `78.6 hz`

### List toggle update

- Hel: `402.4 hz`
- naive DOM: `501.1 hz`
- Vue: `308.8 hz`
- React: `134.8 hz`
- Solid: `518.1 hz`

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

The major improvement in Hel came from:

- specialized branch slots instead of generic block handling for conditionals

Hidden branches used to be retained for this path. They are now disposed, because retention made lifecycle depend on syntax. In Chromium, toggling a branch with a keyed list went from 0.14 ms to between 0.16 and 0.20 ms with 20 rows, and from about 4.8 ms to between 4.8 and 6.7 ms with 1,000 rows. The comparison figures below predate this change.

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
- memory and hydration budgets
- benchmark runs on other machines and browsers

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
- runs with the Node `browser` condition so Solid resolves to its client renderer
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

### A `const` that reads state is cached

`const doubled = count * 2` is computed once per change, however often it is read.

### Keep router expectations realistic

The router is intentionally small and fast enough for the current scope, not a full data-router framework.

## Current Honest Summary

Today, `Hel` is strongest when:

- UI state is local
- DOM updates are narrow
- component structure is predictable
- branches and keyed lists align with the specialized compiler and runtime paths

It is not yet finished in:

- performance budgeting
- final performance documentation for `1.0`

## Related Docs

1. [REACTIVITY.md](REACTIVITY.md)
2. [API-REFERENCE.md](API-REFERENCE.md)
3. [SSR-HYDRATION.md](SSR-HYDRATION.md)
4. [M2-DESIGN.md](M2-DESIGN.md)
