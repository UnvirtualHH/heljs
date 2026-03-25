# Limits and Non-Goals

This document states the current limits of `Hel` and the things it is deliberately not trying to solve in core.

That matters because the framework is intentionally trying to stay small.

## Current Limits

### Compiler limits

- only PascalCase components are transformed
- reactive `let` destructuring is not supported
- component parameters must currently be a simple identifier
- helper analysis is intentionally local and conservative
- unsupported syntax should fail clearly, but that diagnostic surface is still growing

### Runtime limits

- hydration is strong on the intended path, but the full structural contract is not yet finalized
- some structural edge cases still need broader hardening
- internal low-level primitives are public, but not all of them should be treated as stable end-user surface forever

### Store limits

- `store(...)` is intentionally local and coarse-grained
- it is not a full global state architecture
- it is not trying to replicate every Solid store capability

### Router limits

- no nested routes
- no guards
- no loaders or actions
- no large framework-level data orchestration

### Packaging limits

- ESM-only
- no CJS output
- no final semver policy yet

## Non-Goals for Core

The following are intentionally not goals for the first core of Hel.

### 1. Deep orchestration layers

Hel core is not trying to ship all of these:

- data fetching framework
- query cache system
- mutation orchestration
- global normalized store

Those can live on top later if the ecosystem needs them.

### 2. Full meta-framework routing

Hel core is not trying to become:

- a nested layout router
- a data router
- a route-loader and action framework

The current router goal is smaller:

- route matching
- params
- query
- history
- anchors first

### 3. User-authored reactivity primitives everywhere

The framework is not trying to push users toward:

- `signal()`
- `effect()`
- `memo()`

The whole point is to let normal TypeScript stay normal where possible.

### 4. Fully magical deep analysis

Hel does use compiler magic, but not unlimited compiler magic.

It is not a goal to perform:

- perfect inter-module reactive analysis
- perfect alias tracking
- full-program inference for arbitrary JavaScript patterns

The target is precise enough magic, not magical behavior at any cost.

### 5. A giant built-in abstraction surface

The core should remain small enough that:

- the semantics are understandable
- the compiler can stay predictable
- the runtime can stay measurable

If a feature threatens that shape, it should default to:

- staying out of core
- or shipping later once the base is stable

## What Hel Is Trying to Be

Hel is trying to be:

- compiler-first
- VDOM-free
- direct DOM
- local-state friendly
- SSR and hydration capable
- small enough to reason about

That means the framework should be judged against this question:

- does this feature help the core model stay strong and usable?

not this one:

- can this feature make core solve every problem by itself?

## Practical Boundary for Contributors

A good core addition usually has at least one of these properties:

- improves correctness
- improves predictability
- improves performance on measured hot paths
- improves package or starter usability
- improves documentation of already supported semantics

A suspicious core addition usually looks like this:

- large orchestration layer
- implicit global behavior
- hidden data loading system
- API surface that duplicates something a higher-level library could own

## Current Honest Position

Today, Hel is already enough for:

- local interactive UI
- keyed lists
- forms
- small routed apps
- SSR and hydration on the intended path
- external consumption through package builds

Today, Hel is not yet trying to be:

- a full app platform
- a final production router framework
- a final production store ecosystem
- a final meta-framework

That is intentional.

## Related Docs

1. [GETTING-STARTED.md](C:/projects/hellscript/codex%20version/docs/GETTING-STARTED.md)
2. [API-REFERENCE.md](C:/projects/hellscript/codex%20version/docs/API-REFERENCE.md)
3. [REACTIVITY.md](C:/projects/hellscript/codex%20version/docs/REACTIVITY.md)
4. [SSR-HYDRATION.md](C:/projects/hellscript/codex%20version/docs/SSR-HYDRATION.md)
5. [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
