# TODO

Roadmap from the current prototype to a production-ready framework.

Current status:

- compiler-first transform for `let` state, JSX, and local helper functions
- direct DOM runtime without a virtual DOM
- SSR HTML output
- hydration MVP for the happy path
- Vite-based dev and build flow

What it is not yet:

- not a stable production framework
- not a locked public API
- not broad test coverage
- not a fully established performance or compatibility baseline

## Phase 1: Correctness First

Goal: reactivity, DOM updates, SSR, and hydration must be deterministically correct in the core cases.

### Compiler

- [ ] Harden transform rules for `let`
  - scope shadowing
  - nested closures
  - loops and branches
  - default parameters and rest parameters
- [x] Decide the destructuring strategy
  - either implement it cleanly
  - or block it explicitly with a clear compiler error
- [x] Explicitly block component parameter destructuring for now
  - until props tracking is actually defined correctly for it
- [ ] Introduce official escape hatches
  - `noTrack(...)` or a compiler pragma
  - documented semantics for hot paths and foreign objects
- [ ] Expand compiler diagnostics
  - unclear transform cases
  - unsupported syntax
  - hydration-relevant warnings

### Runtime

- [x] Add hydration mismatch detection
  - dev: visible warning with path information
  - prod: local fallback remount
- [x] Harden claiming for fragments and multi-root components
- [x] Unify boolean, property, and attribute semantics
- [x] Stabilize event binding behavior
  - no duplicate listeners
  - no lost listeners after block switches
- [x] Define cleanup and lifecycle rules
  - when effects disappear
  - what happens for removed block slots
- [x] Define reactive props through function components cleanly
- [x] Make reactive component props fine-grained enough
  - no large `dynBlock` re-renders for form subtrees
  - JSX components like `<TodoCard ... />` must stay stable without focus loss

### SSR and Hydration

- [ ] Align SSR and client semantics
  - text
  - attributes
  - block slots
  - fragments
- [ ] Lock in a deterministic marker contract
- [ ] Build hard tests for the SSR -> hydration -> update chain
- [ ] Check structural equivalence between client and server renderers

### Gate for Phase 1

- [ ] 0 known reproduction cases with duplicate DOM or an empty tree
- [ ] 0 known reproduction cases with incorrect post-hydration updates
- [ ] Compiler emits clear errors for unsupported syntax instead of silent wrong semantics

## Phase 2: Test Base and Quality

Goal: the framework must no longer be verified only manually.

### Compiler Tests

- [x] Snapshot tests for transform output
- [ ] Semantic tests for:
  - reads
  - writes
  - prefix/postfix
  - logical assignments
  - [x] helper function analysis
  - [x] static vs dynamic slot decisions
- [ ] Negative tests for invalid or not-yet-supported syntax

### Runtime Tests

- [x] DOM tests for text slots
- [x] DOM tests for attr slots
- [x] DOM tests for block slots
- [x] Tests for fragment and multi-root components
- [x] Cleanup tests for removed subtrees

### SSR and Hydration Tests

- [x] String renderer snapshots
- [x] Hydration tests against prerendered HTML
- [x] Mismatch fallback tests
- [x] Event rebinding tests after hydration

### Tooling

- [x] Properly introduce a test runner
  - preferably Vitest
- [x] Define a headless DOM test environment
  - `happy-dom` or `jsdom`
- [x] Define a CI baseline
  - typecheck
  - test
  - build
- [x] Split framework code into subfolders by responsibility
  - `compiler/`
  - `runtime/`
  - `server/`
  - `package/`
- [x] Physically remove flat legacy facades
- [x] Finalize public entry points intentionally
  - active entry points now live in `compiler/`, `runtime/`, `server/`, and `package/`

### Gate for Phase 2

- [x] Core paths are covered by automated tests
- [x] CI runs green on every commit
- [ ] Regression cases can be reproduced by tests

## Phase 3: Performance Foundation

Goal: not Solid-level, but clearly better than a naive DOM approach.

### Compiler

- [x] Detect static subtrees
- [x] Prepare template cloning for static structures
- [ ] Further reduce unnecessary `dyn*` wrappers
  - [x] direct cell text bindings via `text(...)`
  - [x] direct cell attr bindings via `attr(...)`
  - [ ] identify further conservative special cases
- [ ] Measure and reduce closure allocations in output
  - [x] reproducible transform metrics as a test base
  - [x] CLI report or benchmark report with reliable output

### Runtime

- [x] Introduce template instantiation for static elements
- [ ] Make block updates finer-grained
  - today many cases still replace the whole slot
  - later smaller DOM mutations
  - [x] place keyed lists without unnecessary reinserts on stable order updates
  - [x] patch keyed lists in place instead of root-replacing when structure matches
  - [x] add a general block fast path for pairwise patchable node lists
  - [x] drive conditional branches through a specialized branch slot instead of generic `dynBlock(...)`
- [ ] Harden the internal batch model
  - [x] coalesce redundant re-schedules of the same effects in the same tick
- [ ] Measure subscription and effect overhead
  - [x] runtime stats for effects, reads, writes, and scheduling
  - [x] DOM mutation counters for inserts, removes, replaces, and in-place patches
  - [x] micro-benchmarks for fanout updates as well as setup and cleanup

### Benchmarks

- [ ] Build out micro-benchmarks
  - [x] counter
  - [x] table updates
  - [x] list toggle
  - large static subtrees
  - [x] dedicated runtime harness outside Vitest
- [ ] Define a comparison baseline
  - [x] Vue
  - [x] React
  - [x] Solid
  - [x] naive DOM variant
- [ ] Define a performance budget
  - initial render
  - hydration
  - update latency
  - memory use

### Gate for Phase 3

- [ ] No obvious O(n) disasters on standard paths
- [ ] Measurable improvement over the current prototype
- [ ] Hydration and updates remain stable under load

## Phase 4: API and Language Model Semantics

Goal: the framework should become predictable for users.

### Semantics

- [ ] Document exact rules for reactive `let`
- [ ] Document rules for `const` helpers and derived values
- [ ] Decide whether to add a true internal `memo` or deliberately keep it out
- [ ] Decide whether keyed lists stay a primitive or become a compiler pattern
- [ ] Decide what intentionally does not become magical

### User-Facing API

- [ ] Define the official entry surface
  - `mount`
  - `hydrate`
  - SSR render function
- [ ] Finalize the package structure
  - core
  - Vite plugin
  - SSR
- [ ] Standardize error and warning formats
- [ ] Keep the router API for params and query intentionally small

### TypeScript

- [ ] Harden JSX typing
- [ ] Improve event typing
- [ ] Type component props cleanly
- [ ] Export public types for runtime and SSR

### Gate for Phase 4

- [ ] README is sufficient for more than just the demo
- [ ] API is small, clear, and versionable
- [ ] Semantics are explained to users with concrete examples

## Phase 5: Features You Actually Need

Goal: move from "cool prototype" to "something you can build with".

### Rendering Features

- [x] keyed list reconciliation
- [x] simple router MVP
  - normal `<a href>` as the primary path
  - static routes
  - History API + `popstate`
- [x] route params (`/todos/:id`)
- [ ] official list story
  - compiler pattern
  - [x] control-flow helpers (`For`, `Show`)
  - [x] helper
  - [x] `For` fallback for empty lists
  - control-flow component
- [ ] better fragment support across all paths
- [x] test and harden controlled form elements
  - `input`
  - `textarea`
  - `select`
  - `checkbox` / `radio`

### State Features

- [ ] Decide on stores and deep object reactivity
  - [x] minimal proxy store for local object and array mutations
  - [ ] deliberately decide whether fine-grained store semantics are needed
- [x] Add a minimal context API
  - `createContext`
  - `useContext`
  - provider-based subtree sharing
- [ ] Optionally evaluate internal `memo` or derived caching
- [ ] Define the async and resource story
  - intentionally not part of core
  - or a minimal official path

### Ecosystem

- [ ] Sketch a devtools strategy
- [ ] Harden source maps and compiler output error messages
- [x] Build an example app that shows more than a single counter
- [x] Build a small real demo app with routing and local persistence

### Gate for Phase 5

- [x] At least one small real app can be built without workarounds
- [x] Lists, forms, and multi-level component trees work reliably

## Phase 6: Packaging, Release, and Compatibility

Goal: the thing must be publishable and consumable.

### Packaging

- [x] Define the `exports` map cleanly
- [x] Set up a clean ESM-first release
- [ ] Either deliberately exclude CJS or solve it separately
- [ ] Define versioning and changelog strategy

### Tooling Integration

- [x] Make the Vite plugin publicly consumable
- [x] Provide a minimal SSR integration example
- [x] Create templates and starters
- [x] Automatically verify external consumers against package artifacts
  - `starter/`
  - `starter-ssr/`

### Browser and Platform

- [ ] Define the browser support matrix
- [ ] Validate hydration and DOM features against target browsers
- [ ] Define supported Node versions for the SSR build

### Release Engineering

- [x] CI/CD for releases
- [x] Automated package verification before publish
- [ ] Define semver rules

### Gate for Phase 6

- [x] Framework can be installed as a package and used in a new project
- [x] Release process is reproducible
- [ ] Support matrix is documented

## Phase 7: Production Readiness

Goal: not just "works for me", but reliable under outside use.

### Stability

- [ ] Clean up the bug backlog
- [ ] Gather crash and edge-case telemetry from example projects
- [ ] Define migration and breaking-change policy

### Documentation

- [x] Getting Started
- [x] API reference
- [x] SSR and hydration guide
- [x] Reactivity model
- [x] Performance guide
- [x] Limits and non-goals

### Adoption

- [ ] Build 2-3 real example projects
- [ ] Incorporate feedback from real usage
- [ ] Only then lock the API toward `1.0`

### Final Go-Live Gate

- [ ] green CI
- [ ] solid test coverage in compiler, runtime, and SSR
- [ ] documented and understandable hydration semantics
- [ ] no known critical correctness bugs
- [ ] reproducible performance benchmarks
- [ ] working packaging and release pipeline

## Pragmatic Order of Work

If we stay strict about leverage, this is the sensible order:

1. close hydration mismatch handling and correctness gaps
2. build out the test suite for compiler, runtime, and SSR
3. template and static-tree optimizations for performance
4. keyed lists and form or DOM edge cases
5. API, packaging, and release hardening
6. build real apps and derive the `1.0` semantics from those
