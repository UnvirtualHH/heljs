# M2 Design

The goal of M2 is a compiler-first framework without a virtual DOM that feels like "normal TypeScript + JSX" in user code:

- `let` for local mutable state
- `const` for normal derivations and helpers
- no `signal()`, `memo()`, or `effect()` API in user code
- direct DOM updates instead of a virtual DOM
- SSR and hydration as a real path, not just client-only mounting

M1 is a usable base for that, but still not close enough to the target requirement. M2 closes three gaps:

1. Reactivity must carry through normal helper functions and closures.
2. Hydration must claim existing DOM instead of rerendering it.
3. The compiler needs clear rules for `let`, `const`, captures, and dynamic expressions.

## Target Shape

Example of the intended M2 user code:

```tsx
export function Counter() {
  let count = 0;
  let step = 1;

  const label = () => `${count} clicks`;
  const doubled = () => count * 2;
  const canReset = () => count > 0;

  function increment() {
    count += step;
  }

  return (
    <section class="counter">
      <button onClick={increment}>{label()}</button>
      <p>Double: {doubled()}</p>
      <button disabled={!canReset()} onClick={() => (count = 0)}>
        Reset
      </button>
    </section>
  );
}
```

Expected semantics:

- `count` and `step` are reactive cells.
- `label`, `doubled`, and `canReset` remain normal functions.
- If those functions read reactive `let` bindings, their calls are tracked cleanly in dynamic DOM slots.
- Event handlers write directly to the same cells.
- SSR produces HTML plus markers; hydration reuses existing nodes.

## M2 Architecture

M2 consists of three layers:

1. compiler
2. runtime
3. SSR and hydration protocol

### 1. Compiler

The compiler stays AST-first, but gets an explicit render graph instead of only blindly rewriting `let` and JSX.

#### 1.1 Component detection

For now, M2 stays with PascalCase components.

Reasons:

- clear boundary for the transform
- compatible with JSX conventions
- avoids magical transformation of arbitrary helper functions outside components

Supported forms:

- `function Counter() {}`
- `const Counter = () => {}`
- `const Counter = function () {}`

Not part of M2:

- automatic reactivity for arbitrary non-component modules
- class components

#### 1.2 Reactive bindings

M2 rule:

- `let` inside component scope is treated as a reactive binding by default.
- `const` stays lexical and is not rewritten into state.

Reasoning:

- `let` is the best fit for mutable state.
- `const` should keep normal TypeScript semantics.
- making `const` reactive too quickly leads to hard-to-predict behavior.

What improves for `const` anyway:

- `const helper = () => count * 2` works because the helper reads a reactive `let` when it executes.
- `const view = <div>{count}</div>` is correctly wired into a dynamic slot as a JSX expression.

Not in M2:

- `const doubled = count * 2` as an automatically cached computed value
- implicit incremental dataflow analysis for every `const`

If wanted later, that is an M3 topic: compile-time promoted derived values.

#### 1.3 Scope and capture rules

M2 introduces the following rule:

- a `let` becomes `cell(...)`
- every read inside the component tree becomes `get(cell)`
- every write becomes `set(cell, ...)`
- closures do not need any special API; captures work through the normal JS closure model over the rewritten `cell` accesses

Example:

```tsx
let count = 0;

function doubled() {
  return count * 2;
}

return <p>{doubled()}</p>;
```

becomes:

```ts
const __cell_count_0 = __cell(0);

function doubled() {
  return __get(__cell_count_0) * 2;
}

return __h("p", null, __dyn(() => doubled()));
```

That is the core requirement for making "normal functions" really work.

#### 1.4 Dynamic expressions

M1 wraps practically every JSX expression in `dyn(() => expr)`. That is simple, but too coarse.

M2 splits expressions into static and dynamic:

- static: no reads of reactive bindings
- dynamic: direct or indirect reads of reactive bindings

Compiler decision:

- JSX text with only literals stays static
- a JSX expression becomes `dyn(...)` only if it contains reactive reads or a function call that may contain reactive reads
- event props stay plain functions

Conservative M2 heuristic:

- if an expression contains a call to a locally defined function, treat it as dynamic when that function reads any reactive `let` in the same component
- false positives are acceptable
- false negatives are not

This is intentionally more conservative than M1, but much closer to the target requirement.

#### 1.5 Function analysis

The compiler performs local function analysis per component:

- collect all `let` bindings
- collect the reactive bindings read by each local function
- mark functions as "reactive readers" if they directly or transitively contain reactive reads

Algorithm:

1. find all local function declarations and function expressions
2. build the set of direct reads of reactive `let` per function
3. build a simple call graph for local function calls
4. compute the transitive closure for "function reads reactive state"
5. use that information for JSX expressions and prop expressions

Limits of M2:

- only local, statically resolvable calls
- no inter-module dataflow tracking
- no perfect alias analysis

That is enough for the intended style of small helpers inside components.

#### 1.6 Statements and operators

M2 keeps the robust part from M1:

- `=`
- `+=`, `-=`, `*=`, `/=`, `%=` and similar
- `&&=`, `||=`, `??=`
- `++`, `--` with correct prefix and postfix semantics

Additional requirement for M2:

- writes inside `for` and `while` contexts must transform correctly
- destructuring remains explicitly outside the scope of M2

#### 1.7 Escape hatches

M2 needs a small clear opt-out rule.

Proposal:

- `let raw = noTrack(expr)` stays untransformed
- or a comment pragma such as `/* @raw */ let temp = ...`

Goal:

- do not make everything magical
- provide a workaround for hot paths and foreign objects

That should stay rare, but the compiler needs an official escape hatch.

### 2. Runtime

The runtime stays fine-grained and DOM-direct. M2 builds on the current `cell/get/set/effect/dyn` direction.

#### 2.1 Scheduler

The microtask scheduler from M1 stays.

Why:

- natural batching without a user API
- fewer cascade updates
- DOM updates are collected consistently

M2 may add an internal `batch()` function, but not as a user API. The runtime needs it for hydration and DOM claiming.

#### 2.2 Dynamic slots instead of full child replacement

M1 replaces the whole current node list for dynamic children. That is acceptable for M1, but too coarse for hydration and larger subtrees.

M2 introduces explicit slot types:

- `textSlot(read)`
- `nodeSlot(read)`
- `attrSlot(el, key, read)`
- `blockSlot(read)`

Goal:

- patch text as text only
- patch attributes as attributes only
- blocks can replace node ranges
- the same slots work for SSR and hydration

Internal shape:

```ts
type Slot = {
  start: Node;
  end: Node;
  update(): void;
};
```

A text slot can optimize down to one text node; a block slot manages a marker range.

#### 2.3 Component return values

M1 loses all nodes except the first when a function component returns multiple roots. M2 fixes that.

New rule:

- `h(Component, props, children)` may return `Node | DocumentFragment | Node[] | primitive`
- the runtime fully normalizes that into a stable node range

That also matters for hydration, because components otherwise have no consistent claim boundary.

#### 2.4 DOM operations

M2 introduces a small internal host layer:

- `createElement(tag)`
- `createText(value)`
- `insert(parent, node, anchor)`
- `removeRange(start, end)`
- `setProp(el, key, value)`
- `createMarker(name)`

Why:

- SSR and client share the same render semantics
- hydration can follow the same abstract flow as mount, but with claim instead of create

### 3. SSR and hydration protocol

This is the most important new part.

#### 3.1 SSR format

The server renders HTML directly and writes markers for dynamic areas.

Example:

```html
<section class="counter">
  <button><!--hs:slot:0-->0 clicks<!--/hs:slot:0--></button>
  <p>Double: <!--hs:slot:1-->0<!--/hs:slot:1--></p>
  <button><!--hs:attr:2:disabled--></button>
</section>
```

Alternatively for attributes, when comment markers are awkward:

- `data-hs-a="2:disabled"`
- `data-hs-s="0"`

Decision for M2:

- node dynamics via comment markers
- attribute hydration via `data-hs-*`

Reason:

- HTML parsing remains robust
- claiming text and block slots becomes easier

#### 3.2 Client hydration

Instead of only `mount()`, M2 needs two paths:

- `mount(factory, target)` for pure client rendering
- `hydrate(factory, target)` for existing SSR markup

Hydration algorithm:

1. traverse the DOM under `target`
2. build a cursor over markers and elements
3. when the compiler expects `textSlot` or `blockSlot`, claim the matching marker range
4. when a static node is expected, conservatively validate tag and structure
5. attach event handlers
6. register effects without rebuilding the initial DOM

Mismatch strategy for M2:

- in `dev`: warn with path info and fall back to client remount for the smallest affected subtree
- in `prod`: silently remount the affected local subtree

A global hard fail is not required.

#### 3.3 Compiler output for SSR and hydration

The compiler does not generate two different user APIs, but two backends:

- client backend
- SSR backend

Both use the same transformed component body.

Example:

```ts
return __template(
  ["<p>Count: ", "</p>"],
  [__slot(() => __get(__cell_count_0))]
);
```

Client:

- creates DOM from the template and registers slots

Server:

- serializes strings plus markers

Hydrator:

- maps slots onto existing markers

That is cleaner than rewriting JSX only to `h(...)` and trying to bolt SSR on later.

## Recommended M2 Work Packages

### Package 1: Stabilize reactive helper functions

Goal:

- local function analysis
- transitive marking of reactive readers
- `dyn()` only for actually or potentially dynamic expressions

Acceptance criteria:

- `const doubled = () => count * 2` updates in the DOM
- `function label() { return count }` updates in the DOM
- static JSX expressions do not produce a dynamic slot

### Package 2: Move the runtime to slots

Goal:

- replace `mountDynamicChild()` with a slot system
- split text, attribute, and block slots

Acceptance criteria:

- text updates no longer replace whole subtrees
- dynamic attributes and booleans behave stably
- components with fragments or multiple roots work

### Package 3: Hydration MVP

Goal:

- define the SSR marker format
- implement `hydrate()`
- support claiming for text and block slots

Acceptance criteria:

- a server-rendered counter example hydrates without a full remount
- events work after hydration
- the first state change patches existing nodes

### Package 4: SSR compiler backend

Goal:

- compile output for HTML serialization plus markers
- shared template and slot model between SSR and client

Acceptance criteria:

- the same component can compile to HTML and DOM
- markers are deterministic
- the hydrator can claim the result unambiguously

## What M2 Intentionally Does Not Solve Yet

- keyed list diffing
- stores or proxies for deep object reactivity
- suspense and async resources
- devtools
- inter-module reactive analysis
- automatic computed caches for `const` expressions

Those belong to later milestones.

## Concrete Compiler Rules for M2

Short version:

- `let` in component scope: reactive
- `const`: do not rewrite into reactivity
- reads of reactive `let`: `get(cell)`
- writes to reactive `let`: `set(cell, next)`
- local functions with reactive reads: mark as reactive readers
- JSX expressions or props with a reactive reader or reactive read: `dyn(() => expr)`
- event props: never `dyn`, always plain function

That is the smallest rule set that still feels magical to users but remains controllable for the compiler.

## Recommendation

M2 should build on the current Hel codebase, not on the Claude version.

Reasons:

- the scoping model is already cleaner
- the scheduler is already usable
- the compiler is closer to real analysis than to string-based heuristics
- Vite integration massively speeds up iteration

The correct direction is not "less magic", but "more precisely compiled magic".
