# What the Pet Shop Showed

[pet-shop](../pet-shop) is a real application built against the published package: catalog with URL-bound search, filters, sorting, and pages, pet details with dependent data and reviews, a persistent cart, checkout with failure cases, orders, sign-in, and an admin table. It has a real API and renders on the server per request.

It exists to answer the question from [DESIGN-DECISIONS.md](DESIGN-DECISIONS.md):

> If the Pet Shop regularly needs `cell`/`get`/`set`, or workarounds for the compiler, the promise of plain code does not hold and the project should say so.

## Verdict

**The promise held, but only after 13 bugs in the framework were fixed.** The finished shop has about 1,300 lines of application code and uses no `cell`, `get`, `set`, `effect`, `memo`, or `untrack` at all.

| From `heljs/runtime` | Uses |
| --- | --- |
| `For` | 8 |
| `useResource`, through one small `useApi` helper | 1 |
| `ErrorBoundary` | 1 |
| `createContext` and `useContext` | 1 each, to hand over preloaded data |
| `onMount` | 1, to restore browser storage |
| `onCleanup` | 1, for the search timer |
| `store` | 1 |
| `let`, nearly all of it state | about 35 |
| `cell`, `get`, `set`, `effect`, `memo`, `untrack` | **0** |

Two caveats. I wrote both the framework and the shop, so this is not what a newcomer would experience. And nothing here compares Hel with another framework yet.

## What it found in the framework

All of these are fixed and have tests. None of them showed up in the 264 tests that existed before.

| Bug | What it looked like |
| --- | --- |
| Refetching rebuilt every keyed row | **Saving one row in the admin table silently erased what was typed in another, and took its focus** |
| A provider with a dynamic `value` had markers only on the client | The whole app was rebuilt on hydration. A production build shows no warning |
| `initial: undefined` counted as having preloaded data | The resource never loaded anything |
| SVG got the HTML namespace | The cart icon was invisible |
| Whitespace in JSX was dropped | `{emoji} {name}` lost its space |
| `htmlFor` was ignored on the server and in templates | Labels were not connected to their inputs |
| `<br />` in a template | Two line breaks |
| The HTML parser merges adjacent text | `{breed}, {age} years` reported a mismatch and was rewritten |
| Whitespace or an empty value between elements | Hydration gave up on all the following siblings |
| A number in `value` of an input | A false mismatch |
| `<select value>` and `<textarea value>` on the server | The preselected option was missing, and a textarea lost its content on hydration |
| The not-found page used eager children | A mismatch on hydration |
| The index of a keyed row stayed stale when rows moved | Wrong index without any warning |

The first one is the important one, and it needed a design change rather than a fix:

**Keyed rows now stay alive.** The compiler rewrites the parameters of a row function so they read the current value, the same way props work. A row is only rendered again if its function reads the item directly in its own body. When the compiler cannot rewrite a row safely, such as with a default value in a destructuring pattern, it stays plain and renders again as before. As a side effect, a refetch of 2,000 rows got about 25% faster.

Two small additions came out of real needs:

- `mount` and `hydrate` now return a function that unmounts the root. Without it, tests could not clean up after themselves.
- `router.hasMatch()` tells the server when to answer with a 404.

## Still rough

These stayed as they are. None blocked the shop, but each one is friction.

- **`let` and TypeScript narrowing.** `let user: User | null = null` narrows to `null` for the code below it, because TypeScript cannot see that the variable changes later. A property of the returned object then has the type `never`. The workaround is `let user = null as User | null`, and every union-typed `let` read at the top level needs it. This is the one place where plain code does not quite work, and I do not see a fix inside the compiler.
- **Reading `.value` before `.error`.** `pet.value ? a : pet.error ? b : c` shows the right thing, but also reports an uncaught error, because `.value` throws. I wrote it that way myself on the orders page. The rule is still right, since a failure must not look like empty data, but it is easy to trip over. A compiler warning for this exact shape would be possible.
- **`For` has no type inference.** Row parameters need an annotation: `(pet: Pet) => …`. The same goes for `key`.
- **Starting fresh per id takes a deliberate line.** A page keeps its `let` state from `/pets/1` to `/pets/2`. Reading the id in the route's `view` rebuilds it, including its error boundary, which reads well once you know it. Forgetting it would leave a failed boundary on screen for the next pet.
- **Preloading is written by hand.** About 25 lines per app so far, and they repeat the URL helpers of the pages. That is fine at this size, so `renderToStringAsync` is not needed yet.
- **A shared router on the server is only safe because rendering is synchronous.** This works and is commented in the code, but one `await` between `navigate` and `renderToString` would mix up requests.
- **Uncompiled `h()` with eager children cannot hydrate**, because children are claimed before their parent. Compiled code is not affected.
- **Hydration warnings only exist in a development build.** The shop's first version looked perfect in production while rebuilding the whole page. Its hydration test now runs every route against the real server bundle.

## What the decisions looked like in practice

- **Dynamic by default.** Module-level state, stores, and helpers from other modules all simply updated. There was not a single missing slot.
- **Derived `const`.** About 15 uses, such as `const available = props.pet.stock - inCart`, and no surprises. One `const first = url()` became a derived value without being meant as one, which was harmless. This was the decision with the least evidence behind it, and it held.
- **`use*` functions.** Cart, session, toasts, and `useApi` read like ordinary modules.
- **Hidden branches are disposed.** Never a problem, and it made resets easy to reason about.
- **`useResource` with two functions.** The dependent data on the pet page, `useApi(() => props.url)`, needed nothing special.
- **`<ErrorBoundary>`.** One boundary, on the pet route. Everything else used `.error` directly, which suggests that explicit error state is the common case.

## Cost

Runtime size, minified, compared with `79003c5`:

| | `79003c5` | Now |
| --- | --- | --- |
| `runtime` | 27.3 KB, 9.5 KB gzip | 29.0 KB, 10.1 KB gzip |
| `server` | 7.9 KB, 3.1 KB gzip | 8.6 KB, 3.4 KB gzip |

Speed in Chromium, both runtimes on one page in a production build, alternating, 60 rounds, without the first five:

| Scenario | `79003c5`, median | Now, median | Ratio |
| --- | --- | --- | --- |
| Mount 5,000 rows with two slots | 56.6 ms | 60.3 ms | 1.07 |
| Update 5,000 cells | 1.6 ms | 1.6 ms | 1.00 |
| Keyed list: reverse, shrink, clear, refill | 19.5 ms | 19.8 ms | 1.02 |
| Refetch: 2,000 rows, new objects, three times | 47.3 ms | 35.4 ms | 0.75 |
| Toggle a branch 40 times | 14.7 ms | 14.9 ms | 1.01 |

Mounting ranged from 54 to 68 ms on the old runtime, so its difference is within the spread. It has moved in the same direction in every comparison so far, though, and deserves a look.

## Verified

- **Framework tests:** 289 passed, plus 2 expected failures: `Date` and `Map` in a store, which the shop never needed because its data comes from JSON.
- **Shop tests:** 42 passed. They drive the real pages against the real API handlers, and hydrate every route from the real server bundle.
- **Chromium:** every flow by hand on the server-rendered build with development warnings on, with no hydration warnings: search with focus, filters, back and forward, cart, a declined card, a successful order, cancelling, a missing pet, sign-in, and the admin table. Also the development server without SSR.

## Not verified

- Other browsers
- Accessibility beyond labels and roles
- Real load on the server, or memory over a long session

## What is next

In the order I would do them:

1. Publishing the package.
2. A compiler warning for `.value` read before `.error`.

The comparison with other frameworks is in [PERFORMANCE.md](PERFORMANCE.md).
