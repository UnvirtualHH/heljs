# Async Data and Errors

Status: **decided and implemented.**

This paper covers what the Pet Shop needs beyond the [language model](DESIGN-DECISIONS.md): loading data, and failing. The evidence was measured on commit `6f5dbb8`, before implementation, in Vitest with happy-dom, using a prototype that was thrown away afterwards. File references point to that commit. [Where the implementation differs](#where-the-implementation-differs-from-this-paper) and [what was verified](#verified) are at the end.

## Summary

| # | Question | Decision |
| --- | --- | --- |
| 0 | What is broken today, regardless of the design? | Fix first, see the table below |
| 1 | What about `async function Comp()`? | Compile error. Rendering a Promise throws |
| 2 | How does async data enter the reactive graph? | `useResource(source, fetcher)` |
| 3 | How is loading shown? | Explicitly with `pet.loading`, no Suspense |
| 4 | What happens when something throws? | `<ErrorBoundary>`, and a failed slot never shows dead content |
| 5 | What about SSR? | `renderToString` stays synchronous, the server never fetches, preloaded data comes in through `initial` |
| 6 | When does the router re-create a view? | When the matched route changes, or something the view reads itself |

## The principle still applies

> Code either updates or fails loudly. It never stays silently stale.

Async code and errors break this more often than anything measured so far.

## Evidence

### What already works

| Scenario | Result |
| --- | --- |
| `onMount(async () => { data = await load(); })` | updates |
| Async event handler writing `let` before and after `await` | updates |
| One effect throws during a flush | the others still run |
| A text or block slot throws, then its dependency changes | recovers |
| A component throws during `mount`, `renderToString`, or `hydrate` | the exception reaches the caller |

### What fails silently

| Scenario | Result |
| --- | --- |
| `async function Comp()` | renders `[object Promise]`, on client and server, no error |
| `async function Comp() { const d = await load(); }` | compiler emits `__memo(() => await load())`, which is not valid JavaScript |
| `const user = load(id)`, then `{user}` | `[object Promise]`, and every change starts another request |
| `useContext` in `onMount` | returns the default value, ignoring the provider |
| `onCleanup` in `onMount` | dropped, so `setInterval` plus `onCleanup` leaks |
| The same two calls after an `await` | same result, and this one cannot be fully fixed |
| Effect that fetches on `id`, slow response for 1, fast for 2 | shows the data of 1 while `id` is 2 |
| Effect that reads `id` only after an `await` | never re-runs, shows the data of 1 while `id` is 2 |

The handwritten route also has a trap of its own. The first version of my prototype kept its `AbortController` in a `let`. Every `let` is reactive, so the effect read and wrote state, and the flush limit stopped it, but only after **301 fetcher calls**. With a real `fetch`, those are real requests.

## 0. Bugs to fix regardless

All of these exist in committed code. The two hydration bugs are the most serious, because they delete content.

| Bug | Measured | Where |
| --- | --- | --- |
| A context provider followed by a sibling **loses its content on hydration, with no warning** | `<b>v</b><i>x</i><footer>f</footer>` becomes `<footer>f</footer>` | `slots.ts:796` |
| A mismatch in a branch followed by a sibling loses the content | `<p>no</p><button>` becomes `<button>`, instead of showing `<b>yes</b>` | `slots.ts:796` |
| `useContext` and `onCleanup` do not work in `onMount` | see above | `core.ts:133` |
| A branch whose new arm threw is stuck for good | a later change with the same condition does nothing | `slots.ts:531` |
| A throwing `onCleanup` skips the remaining cleanups | the effect stays subscribed and the old DOM stays | `core.ts:358` |
| A throwing `onMount` skips the remaining mounts of that component, outside `reportError` | | `core.ts:133` |
| A component that throws during setup keeps what it already created | its effect keeps running, its `onCleanup` never runs | `index.ts:216` |
| A keyed row that throws leaks the rows created in that update | their `onCleanup` never runs | `slots.ts:669` |
| A branch whose new arm throws keeps dead content | the old DOM stays, its slots no longer update. A block disposes in the same order, but this was only measured on a branch | `slots.ts:547`, `:491` |
| `api.useThing(id)` is treated as derived, only `useThing(id)` is plain | re-runs on every change | `compiler/plugin.ts` |

The first two share a cause: during hydration, a node is appended at the end of the parent, and closing the frame then removes it. Inserting at the frame's cursor fixed both in a trial, with all 194 tests still passing. That fix can land on its own, right away.

---

## 1. What about `async function Comp()`?

**Options.**

- **A. Make it work.** Vue does this for top-level `await`, together with Suspense. It raises questions without good answers here: what re-runs when `props.id` changes, what happens to a `let` declared after the `await`, and what renders in the meantime.
- **B. Compile error.**

**Recommendation: B.** The error names `useResource` as the alternative. It covers `async` components and `async use*` functions. Choosing A later would not break any code.

Two checks catch what the compiler cannot see:

- Rendering a Promise throws, on client and server, instead of printing `[object Promise]`.
- In development, a `const` whose value is a Promise produces a warning, because it starts a new request on every change and has no protection against races.

---

## 2. How does async data enter the reactive graph?

| | Source of truth | Race safe | Read after `await` | Works with preloaded data |
| --- | --- | --- | --- | --- |
| **A.** Handwritten `onMount`/effect | none | no | stale | by hand |
| **B.** One function: `useResource((signal) => load(props.id, signal))` | tracked until the first `await` | yes | **silently stale** | **no**, skipping the first run loses the dependencies |
| **C.** Two functions: `useResource(() => props.id, load)` | the first function | yes | cannot happen, the fetcher is untracked | yes |
| **D.** `<Await promise={user}>` with a live `const` | the `const` | only with extra work | stale | no |

**Recommendation: C.** B reads more like plain code, but it brings back precisely the failure this project set out to remove. Solid's `createResource` and SWR use the same shape.

```tsx
function PetPage(props) {
  const pet = useResource(() => `/api/pets/${props.id}`, getJson);

  return pet.loading ? <Spinner /> : <PetDetails pet={pet.value} />;
}
```

The name needs no compiler change, since `use*` calls already stay plain, and the arguments follow the existing rule for live input.

| Part | Behaviour |
| --- | --- |
| `source()` | Tracked. Whatever it returns identifies the data. A falsy value means "do not fetch". If the value is unchanged, nothing happens |
| `fetcher(source, signal)` | Untracked. The `signal` aborts when the source changes or the component goes away |
| `.loading` | `true` while a request is running |
| `.error` | The failure, without throwing |
| `.value` | The data. **Throws if the last request failed**, so an unhandled failure cannot look like empty data |
| `.refetch()` | Runs again and keeps the current value while loading. Clears the error |
| `{ initial }` | Starts with this value. Skips the first fetch only while hydrating |
| `{ keepPrevious }` | Keeps the old value when the source changes, for search results that should not flicker |

When the source changes, `.value` goes back to `undefined`. Otherwise the page for pet 2 would show pet 1 while loading.

**Prototype, about 60 lines of plain Hel in a `use*` function:**

| Scenario | Result |
| --- | --- |
| Slow response for 1, fast for 2 | shows 2, and 1 is aborted |
| A slot reading both `props.id` and `.value` | never saw the new id with the old value |
| Source returns the same value after a dependency changed | no second request |
| Falsy source | no request |
| Rejection | `.error` set, `.value` throws |
| `refetch` | value kept, `loading` true |
| Component removed | request aborted |
| `initial`, then the source changes | no first fetch, then one fetch |

**Deliberately not included:** cache, deduplication, retries, polling, and optimistic updates. [LIMITS-AND-NON-GOALS.md](LIMITS-AND-NON-GOALS.md) names these as non-goals for core, and this paper keeps it that way. Writes need nothing new: an async handler that calls `refetch()` works.

---

## 3. How is loading shown?

**Options.**

- **A. Explicit:** `{pet.loading ? <Spinner /> : <PetDetails pet={pet.value} />}`.
- **B. Suspense:** a boundary shows a fallback while anything below it is loading.

**Recommendation: A, for now.** It needs no new concept, it is plain JavaScript, and it composes with everything that already exists. Suspense has to keep a subtree alive while hiding it, and decision 5 of the language model just removed that mechanism. It also needs coordination across the tree that nothing in the Pet Shop calls for. It can be added later without breaking code.

**Known cost.** Several resources on one page mean several loading states, and each one is written out by hand. If the Pet Shop shows this to be painful, that is the argument for B.

---

## 4. What happens when something throws?

```tsx
<ErrorBoundary fallback={(error, retry) => <Oops error={error} onRetry={retry} />}>
  <PetPage id={id} />
</ErrorBoundary>
```

| Thrown from | Goes to |
| --- | --- |
| Component setup, at mount or later | nearest boundary |
| A slot re-running, a keyed row, a `const` being read | nearest boundary |
| `effect` and `onMount` | nearest boundary |
| A `.value` that holds a failed request | nearest boundary, through the slot reading it |
| A fallback | the next boundary outward |
| `onCleanup` | `reportError`. The tree is going away, and the remaining cleanups still run |
| Event handlers and their promises | the browser, as with any other JavaScript. React does the same. Other state stays intact |

`retry` renders the children again from scratch, so a resource inside fetches again.

**Without a boundary.** The error goes to `reportError` and the slot retries on its next change. The question is what it shows until then:

| Slot | Today | Proposed |
| --- | --- | --- |
| Block or branch | old DOM, no longer updating | **empty**, because its scope is gone and showing it would be a lie |
| Text | last value | **empty**, otherwise `{pet.value ?? "loading"}` says "loading" forever |
| Attribute | last value | last value, because removing `disabled` or `class` could be worse |

The alternative is React's: unmount the whole root. That is safer against corrupted state, but one failing price label would blank the entire shop.

**Implementation.** Effects already capture their context frame, so a boundary can be a frame holding an error handler. `Scope.parent` cannot be used, because it is `null` for anything created during a flush. Handling only costs anything once an error actually occurs.

**Prototype on client and server, about 120 changed lines:**

| Scenario | Result |
| --- | --- |
| Setup throws at mount | fallback, siblings outside untouched |
| Throws on a later toggle, then `retry` | fallback, then fresh children |
| A slot throws on re-run | fallback, and effects below stop running |
| Keyed row throws | fallback |
| Nested, or fallback throws | innermost boundary wins, or the next one out |
| Unguarded failed resource, then `retry` | fallback, then a new request and data |
| Hydrate: both sides fine | claimed, no warning |
| Hydrate: only the client fails | fallback replaces the server HTML, the rest stays claimed and interactive |
| Hydrate: both fail | correct, but with a **false mismatch warning** |
| Hydrate: only the server fails | **content lost**, caused by the hydration bug in section 0 |

That last case was not re-run together with the hydration fix. The false warning could go away with a marker in the server output, which I have not tried.

---

## 5. What about SSR?

**Options.**

- **A. The server never fetches.** A resource without `initial` renders its loading state and the client fetches after hydration. A caller who wants data in the HTML loads it first and passes it in.
- **B. Repeated render passes (`renderToStringAsync`).** Render, await what is pending, render again until settled. A pass with 1,000 rows took about 2.8 ms, so cost is not the problem. It needs a stable key per resource, and the value of `source()` could serve as one.
- **C. An asynchronous serializer.** Context frames are module-level state (`server/core.ts:37`), so concurrent requests would interleave across an `await` and read each other's context. Rejected.
- **D. Route loaders.** A documented non-goal for core.

**Recommendation: A now, B after the Pet Shop if it proves necessary.** B can be added on top of A without breaking code. Each pass stays synchronous, so it avoids the problem with C.

```tsx
// entry-server.tsx
const pets = await api.pets();
const html = renderToString(() => <App pets={pets} />);
const page = `${html}<script>window.__DATA__ = ${serializeData({ pets })}</script>`;

// entry-client.tsx
hydrate(() => <App pets={window.__DATA__.pets} />, root);

// App.tsx
const pets = useResource(() => "/api/pets", getJson, { initial: props.pets });
```

`serializeData` would be the one new server helper, because a handwritten `JSON.stringify` inside a `<script>` is an XSS hole.

**Prototype.** Both paths hydrate without a warning, keep their nodes, and stay interactive: with no `initial`, loading state on both sides and one fetch afterwards; with `initial`, no fetch at all. The server side was a stub, not a real implementation.

**Known costs.**

- A page without preloaded data contains only its loading state, which matters for SEO.
- Preloading is written by hand, per route.
- `export const cart = useCart()` is one instance per server process, shared across requests. This is safe only as long as nothing writes to it while rendering, and not fetching on the server helps here. It should be documented.

---

## 6. When does the router re-create a view?

**Today, on every path or query change.** `view()` reads both (`router.ts:105`). Measured: `setQuery` re-ran the page's setup and replaced its `<input>`. Focus and local state are lost, and a resource starts over with a loading flash. A search field bound to the URL cannot work that way.

**Options.**

- **A. Only when the matched route changes.** Everything else already updates through slots, since decision 1 of the language model.
- **B. Also on param changes.** `/pets/1` to `/pets/2` starts fresh.
- **C. Keep it.**

**Recommendation: A.**

**Prototype.** Query and param changes kept the same component and `<input>`. The slots, `const id = router.params().id`, and a resource source all updated, and changing to another route still re-created the view. It took a few lines, and all 194 tests still pass.

**Known cost.** A `let` now survives from `/pets/1` to `/pets/2`, so a "selected image" would carry over to the next pet. This is what Solid's router does too. I ran the prototype only against the tests, so the demo, the website, and the starters still need checking.

---

## Where the implementation differs from this paper

- **`initial`.** It skips the first fetch only while hydrating. As proposed, coming back to a route would have shown the data preloaded with the first page, silently stale. A later instance now starts from `initial` and fetches.
- **Router.** The view re-runs when the matched route changes, or when something it reads in its own body changes, the same as any other expression in JSX. Component setup stays untracked, so `<Page id={router.params().id} />` keeps the page. A view that reads state in its body is rebuilt on every change of that state, so the demo moved its URL sync into an `effect`.
- **False hydration warning.** Solved as suggested: the server marks a failed boundary with a comment, and the client then renders the children fresh after hydration. This also fixes "only the server fails".
- **Fragments.** The provider bug was really a fragment bug. `frag()` now renders in place while hydrating, which also makes slots directly inside a provider or a fragment claim their nodes.
- **Effects.** An effect whose first run throws is now disposed. The prototype left it subscribed.
- **Logging.** A boundary logs what it catches: `console.error` in development on the client, and always on the server, where nobody would see it otherwise.
- **Warnings.** `onCleanup` and `useContext` warn in development when they run outside a component, such as after an `await`. Reads after an `await` still cannot be detected in general.

### Bugs found only in a real browser

Vitest did not show these two. Chromium did:

- `router.view()` produced one block less on the server than on the client, so hydration rebuilt every routed page instead of claiming it. The production demo hid this, because hydration warnings only exist in development.
- A dynamic `href` always reported a mismatch, because the DOM property reads as an absolute URL.

## Verified

- **Tests.** 264 passed, plus the same 7 expected failures as before.
- **Chromium, with SSR, hydration, and real `fetch`.** A small shop page, removed afterwards: provider with a sibling, all boundary combinations, typing in a URL-bound search with focus kept, a slow request replaced by a fast one, `refetch`, a failing pet with `retry`, the shared cart across routes, an interval cleared on leaving a route, and a pet name containing `</script>` that did not break out of `serializeData`.
- **Demo in Chromium, hydrated production build.** Selecting, filtering, back and forward, renaming with focus, adding, deleting, and navigating, with no console errors.
- **Website in Chromium, client mode.** Navigation, counter, context, table sort and paging, search focus, and the modal.
- **Builds.** Typecheck, app, package, website, and both starters.

### Cost

Size of the bundled runtime, minified:

| | `6f5dbb8` | Now |
| --- | --- | --- |
| `runtime` | 24.1 KB, 8.3 KB gzip | 27.2 KB, 9.5 KB gzip |
| `server` | 7.2 KB, 2.7 KB gzip | 7.9 KB, 3.1 KB gzip |

These figures include the development warnings. An application build does not remove them today: they never run in production, but their text stays in the bundle, because `IS_DEV` is computed at runtime. That was already the case before this work, and fixing it would win some of this back.

Speed in Chromium: both runtimes side by side on one page in a production build, alternating, 70 rounds, without the first five:

| Scenario | `6f5dbb8`, median | Now, median | Ratio |
| --- | --- | --- | --- |
| Mount 5,000 rows with two slots | 69.3 ms | 75.6 ms | 1.09 |
| Update 5,000 cells | 1.8 ms | 1.7 ms | 0.94 |
| Keyed list: reverse, shrink, clear, refill | 4.2 ms | 4.3 ms | 1.02 |
| Toggle a branch 40 times | 19.8 ms | 20.1 ms | 1.02 |

Spread between rounds is larger than these differences: mounting ranged from 59 to 109 ms on the old runtime. An earlier run of 25 rounds put mounting at 1.01, and its other figures were too noisy to use. So mounting may have become slightly slower, by somewhere up to 9%. Nothing else moved measurably.

### Not verified

- Website with SSR, since it only runs in client mode
- Hydration warnings in the demo, since its hydrated build is a production build and shows none
- Memory use
- Other browsers
- Whether the explicit loading states stay pleasant in a real app, which is the Pet Shop's job

## Order of work

All steps are done. Next is the Pet Shop.

## Worked example

```tsx
function PetsPage() {
  const q = router.query().q ?? "";
  const pets = useResource(() => `/api/pets?q=${encodeURIComponent(q)}`, getJson, { keepPrevious: true });

  return (
    <section>
      <input value={q} onInput={(e) => router.setQuery({ q: e.target.value }, { replace: true })} />
      {pets.error ? (
        <button onClick={pets.refetch}>Try again</button>
      ) : (
        <ul>
          <For each={pets.value ?? []} key={(pet) => pet.id}>
            {(pet) => <PetRow pet={pet} onAdd={() => cart.add(pet)} />}
          </For>
        </ul>
      )}
    </section>
  );
}
```

`q` stays live, a new search aborts the previous one, the input keeps its focus, and there is not a single primitive beyond `useResource`. The shop page used in the Chromium checks has the same structure, but this exact code was not run.

## Deliberately not decided here

- Suspense and streaming SSR
- Forms and mutation helpers
- A cache, which belongs in a library on top
- `<KeepAlive>`, HMR, and the package fixes
