# Design Decisions

Status: **decided and implemented.**

This paper covers the language-model decisions that block a real app. The evidence was measured on the code as of commit `18c500a`, before implementation. `REACTIVITY.md` describes the resulting behaviour.

## Summary

| # | Question | Recommendation | Decision |
| --- | --- | --- | --- |
| 1 | What counts as reactive when the compiler is unsure? | Dynamic by default, static only when provably static | accepted |
| 2 | What does a `const` that reads state do? | Stays live, computed once per change | accepted |
| 3 | How is reactive logic shared? | Compile `use*` functions the same way as components | accepted |
| 4 | Does component setup track reads? | No, setup is untracked (bug fix) | accepted |
| 5 | What happens to a hidden branch? | Dispose it, offer explicit `<KeepAlive>` later | accepted, `<KeepAlive>` not built |

## The principle behind all of them

> Code either updates or fails loudly. It never stays silently stale.

Almost every serious bug found so far broke this rule: values that looked reactive and quietly were not. The promise on the website is "keep your app code plain". That only holds if plain code does the expected thing, or says clearly why it cannot.

## Evidence

### Usage in demo, website, and starters (20 `.tsx` files)

| Measured | Result |
| --- | --- |
| Non-trivial JSX expressions (handlers, functions, literals, JSX excluded) | 207: 60 member, 55 identifier, 51 call, 41 compound |
| Slots the compiler emits today | 90 (rough comparison, not one to one) |
| `let` in component scope / elsewhere | 8 / 0 |
| Top-level `const` in components | 18 functions, 4 `store()`, 2 `createRouter()`, 1 `useContext()`, 1 member read |
| `const` rewritten into a derived value | 1 (`const todo = props.todo`) |
| `use*` functions defined | 0 |

Two conclusions: decision 2 is cheap to change either way, and it has never been tested by real code. These apps also contain no shared state across components, which is what a Pet Shop would need first.

### How `const` behaves today

```tsx
let count = 0;
const helper = () => count;
```

| Declaration | Behaviour today |
| --- | --- |
| `const a = count` | snapshot |
| `const a = count + 0` | live |
| `const a = helper()` | snapshot |
| `const a = helper() + 0` | live |
| `const a = compute(count)` | live, `compute` re-runs on every read (5 calls in the probe) |
| `const a = { n: count }` | live, a new object on every read |
| `const a = <i>{count}</i>` | a new element on every read |

The rule is accidental: `expressionUsesTrackedValue` only visits children of the initializer, so a bare identifier or a bare call is never inspected.

### A bug found while preparing this paper

A component that reads and writes a `let` during setup re-renders forever inside a block:

```tsx
function Child() {
  let total = 0;
  for (const n of [1, 2]) total += n;
  return <b>{total}</b>;
}

<div>{visible && <Child />}</div>
```

The probe reached 501 renders and only stopped because it threw deliberately. In a browser this hangs the tab, since nothing limits flush cycles. See decision 4.

### Cost of a slot without dependencies

Chromium, 5,000 rows with two slots each, dev build, including layout, 25 rounds per scenario:

| Scenario | Median | p10 to p90 |
| --- | --- | --- |
| Handwritten DOM | 39.7 ms | 34.2 to 52.4 |
| Hel, static row | 42.9 ms | 40.4 to 58.5 |
| Hel, dynamic slots without dependencies | 45.9 ms | 42.9 to 84.2 |

That is about 7% more for mounting, less than the spread between rounds. Memory was not measured.

---

## 1. What counts as reactive when the compiler is unsure?

**Problem.** Anything the compiler does not recognize stays static, without warning. Stores at module level and stores from `useContext` never update.

**Options.**

- **A. Keep the analysis and improve it.** It can never see across modules, so stale values remain.
- **B. Dynamic by default.** The runtime finds the real dependencies. Solid works this way.
- **C. Keep today's default and warn.** Warnings would fire on most member reads.

**Recommendation: B.**

| Expression in JSX | Proposed |
| --- | --- |
| Literal, function, event handler | static |
| Identifier bound to a `let`, a derived `const`, or a prop alias | slot |
| Any other identifier | static |
| Contains a member read or a call | slot |
| Compound of static parts only | static |

**Consequences.**

- At most about 117 more slots across the 20 files, probably fewer because identifiers stay static.
- A slot that finished its first run with no dependencies can never run again. `effect()` should then skip its scope cleanup, otherwise every such row stops counting as static and loses in-place patching. This optimization is not built or measured yet.
- `reactiveStoreNames` and most of the helper analysis become unnecessary, which shrinks the compiler.
- Calls now run inside a tracked effect. A helper that writes state it also reads would loop, so this depends on the flush guard from decision 4.
- The escape hatch is `untrack`, which must then be exported publicly. It is internal today.

**Known cost.** A slot that turns out to hold an element evaluates its expression twice on first render, because the text slot upgrades to a block slot. A single slot type that handles both without re-reading would remove this later.

---

## 2. What does a `const` that reads state do?

**Options.**

- **A. Always a plain snapshot.** Derived values are written as functions. Add a compile error when a snapshot that read state is used in JSX, otherwise it would be silently stale.
- **B. Live and cached.** A `const` that reads state is derived, computed once per change.
- **C. Today's mix.** Not defensible, see the table above.

| | A: snapshot + error | B: live + cached |
| --- | --- | --- |
| `const total = items.reduce(…)` in JSX | compile error, rewrite as `total()` | just works |
| Matches JavaScript semantics | yes | no, a `const` changes value |
| Matches what React developers expect | no | yes, for reads in JSX |
| Side effects in the initializer | run once | re-run on change |
| Object identity | stable | changes when dependencies change |
| Narrowing across `await` | sound | can be wrong |
| Runtime cost | none | needs a new `memo` primitive |

**Recommendation: B.** This reverses an earlier suggestion in favour of A. A snapshot is the honest JavaScript answer, but it pushes users to `total()` everywhere, which is precisely what "plain code" promises to avoid. B accepts one piece of magic in return for code that works unchanged. The Pet Shop should test this choice: it is the decision with the least real-world evidence.

If strict JavaScript semantics matter more to you than the pitch, A is a sound alternative, and the error keeps it from going stale silently.

**Rule for B.** A top-level `const` in a reactive scope is derived when its initializer reads a `let`, prop, derived value, or known reactive helper outside nested functions. These always stay plain:

- function initializers
- JSX, whose slots are reactive by themselves, so the element is created once
- `store(…)`, `new …`, `use*(…)`, and `untrack(…)`

`const` inside nested functions and handlers stays normal JavaScript.

**Consequences.**

- The first evaluation happens at the declaration, so setup order is preserved.
- Handlers read a value right after writing state, so `memo` must be marked dirty synchronously and recompute on read. It cannot go through the microtask queue.
- Plain member reads and destructured props stay simple aliases with no caching.
- `const initial = untrack(() => count)` is the explicit snapshot.
- `REACTIVITY.md` and the README state the opposite today and need rewriting.

---

## 3. How is reactive logic shared?

**Problem.** There is no way to reuse state outside a component except `cell`/`get`/`set`, which the project explicitly does not want in user code. Custom hooks with `let` are silently not reactive.

**Options.**

- **A. `use*` functions are compiled like components.**
- **B. A directive** such as `"use reactive"`. More explicit, more noise.
- **C. Every function containing `let`.** Turns every loop counter into a cell.
- **D. Status quo.** Fails the Pet Shop at the cart.

**Recommendation: A.**

- `use*` functions get the same transform as components, also in `.ts` files. The plugin only handles `.tsx` today.
- An object literal returned from a `use*` function exposes reactive values as getters, otherwise `return { count }` would be a stale snapshot.
- `const { count } = useCounter()` keeps aliases, the same as destructured props.
- Writing through such a property throws a `TypeError`. State changes go through functions.
- Returning an array containing state is a compile error, since elements cannot be getters.
- Arguments are evaluated once. For live input, pass a function: `useUser(() => props.id)`.

**Module-level state.** `export const cart = useCart()` gives a shared instance, and a `store()` at module level works after decision 1. A module-level `let` stays a normal variable, because importers cannot be rewritten. Reading one in JSX should produce a compiler warning.

**What counts as a component.** PascalCase stays the rule, with two additions, since both are silently non-reactive today: anonymous default exports, and `const Name = wrap(() => …)`.

---

## 4. Does component setup track reads?

**Problem.** Setup runs inside whichever effect mounted it. In a block slot, every read during setup subscribes that block. This causes the render loop above, and a store read during setup re-renders and resets the component on each change. Ternary branches already avoid this through `untrack`, so behaviour currently depends on where a component is mounted.

**Recommendation: setup is always untracked.** There is no serious alternative, so this is really a bug fix.

- `renderComponentWithScope` runs the component body in `untrack`.
- `resolveComponentProps` must stay outside it, because uncompiled components re-render through their props.
- Add a flush limit that throws a clear error naming the effect, instead of hanging the tab. Runaway effects are otherwise still possible.

This fix is independent of the other decisions and can land first.

---

## 5. What happens to a hidden branch?

**Today.** Retention is documented and tested, and it exists for toggle performance. In practice:

| Written as | When hidden |
| --- | --- |
| `{show ? <A/> : <B/>}` | kept alive, effects keep running, no `onCleanup`, state survives |
| `{show && <A/>}` without nested slots | disposed, `onCleanup` runs, state resets |
| `{show && <A/>}` with nested slots | kept, chosen by comparing DOM structure |

The same intent gives three behaviours depending on syntax and on the inside of the component.

**Options.**

- **A. Keep it.** Fast toggles, unpredictable lifecycle.
- **B. Always dispose, add `<KeepAlive>` when someone needs it.** Predictable, like every other framework.
- **C. Dispose, but reuse branches that are fully static.** Invisible to users, can be added on top of B later.

**Recommendation: B.**

**Consequences.**

- Toggling lists gets slower. `PERFORMANCE.md` highlights this path, so it should be measured in a real browser before and after.
- Four runtime tests pin retention and must change: `runtime.test.ts:313`, `:356`, `:397`, and `:1725`. A server test only mentions it in its name.
- The retained path in `mountBlockSlot`, the signature comparison, and the branch cache all go away.

---

## Where the implementation differs from this paper

Implementing the decisions turned up four refinements:

- **Decision 2, wider rule.** A `const` follows the same rule as a JSX expression, so any member read or call counts, not just reads of known reactive bindings. Otherwise `const total = cart.total` would have stayed silently stale. A call that reads no state simply never recomputes. `create*(...)` joined the list of setup calls that always stay plain.
- **Decision 2, JSX.** A JSX `const` is created once as proposed, but on its first read rather than at the declaration. Otherwise it would claim prerendered nodes at the wrong position during hydration.
- **Decision 4, flush limit.** The error reports the 100-cycle limit, but cannot name the effect, because effects have no names.
- **Beyond the paper.** Stateless components no longer register a cleanup, so a block containing them can still be patched in place. Calling a destructured function prop (`const { onSave } = props; onSave()`) threw a `ReferenceError` and is fixed.

### Measured toggle cost of decision 5

Chromium, branch with a keyed list, dev build, two runs of seven rounds each:

| Rows | Retained | Disposed |
| --- | --- | --- |
| 20 | 0.14 ms per toggle | 0.16 to 0.20 ms |
| 1,000 | 4.8 to 5.0 ms | 4.8 to 6.7 ms |

The second run of the new code was noticeably noisier, so the upper figures are not reliable. Toggles got somewhat slower, but not dramatically.

## Order of work

1. Decision 4: setup untracking and flush limit.
2. Decision 1, with the no-dependency optimization and an exported `untrack`.
3. Decision 2: `memo` and the new rule.
4. Decision 3: `use*` and `.ts` support.
5. Decision 5: remove retention.
6. Rewrite `REACTIVITY.md`, README, and API reference.

All six steps are done. Next is the Pet Shop.

## Worked example

A shared cart needs no primitives.

```tsx
// cart.ts
export function useCart() {
  let items: CartItem[] = [];
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const isEmpty = items.length === 0;

  function add(item: CartItem) {
    items = [...items, item];
  }

  return { items, total, isEmpty, add };
}

export const cart = useCart();
```

```tsx
// CartBadge.tsx
import { cart } from "./cart";

export function CartBadge() {
  return <a href="/cart">{cart.isEmpty ? "Empty" : `${cart.items.length} items, ${cart.total} €`}</a>;
}
```

## Success criterion

If the Pet Shop regularly needs `cell`/`get`/`set`, or workarounds for the compiler, the promise of plain code does not hold and the project should say so. If it reads like the example above, Hel has something its competitors do not.

## Deliberately not decided here

- Async data and error boundaries, now decided in [ASYNC-AND-ERRORS.md](ASYNC-AND-ERRORS.md)
- HMR
- Semver, and the package fixes
- `Date` and `Map` in `store()`
