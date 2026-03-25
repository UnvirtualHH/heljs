# Hel

![Hel logo](public/hel-192.png)

Compiler-first Prototyp fuer ein Framework ohne Virtual DOM.

Ziel ist Solid-artige Fine-Grained-Reaktivitaet, aber mit normalem TypeScript im User-Code:

- `let` fuer lokalen State
- normale Funktionen und Closures
- JSX ohne `signal()`, `effect()`, `memo()` im User-Code
- HTML-first Routing mit normalen `<a href>`
- direkte DOM-Updates statt VDOM-Diffing

Der aktuelle Stand ist ein brauchbarer M2-Prototyp mit Client-Rendering, SSR-HTML-Output und Hydration-MVP.

## Projektstruktur

Die aktive Struktur ist jetzt fachlich getrennt:

- [src/demo](C:/projects/hellscript/codex%20version/src/demo)
  - Demo-App, Seiten, Daten, Entrys, Styles
- [src/framework/compiler](C:/projects/hellscript/codex%20version/src/framework/compiler)
  - AST-Transform und Compiler-Metriken
- [src/framework/runtime](C:/projects/hellscript/codex%20version/src/framework/runtime)
  - Client-Runtime, DOM, Hydration, Router, Slots
- [src/framework/server](C:/projects/hellscript/codex%20version/src/framework/server)
  - SSR-Runtime, Router, String-Renderer
- [src/framework/package](C:/projects/hellscript/codex%20version/src/framework/package)
  - Paket-Entrypoints fuer externe Projekte

Aktive Einstiegspunkte im Framework-Code sind:

- [src/framework/compiler/plugin.ts](C:/projects/hellscript/codex%20version/src/framework/compiler/plugin.ts)
- [src/framework/runtime/index.ts](C:/projects/hellscript/codex%20version/src/framework/runtime/index.ts)
- [src/framework/server/index.ts](C:/projects/hellscript/codex%20version/src/framework/server/index.ts)
- [src/framework/package/runtime.ts](C:/projects/hellscript/codex%20version/src/framework/package/runtime.ts)
- [src/framework/package/server.ts](C:/projects/hellscript/codex%20version/src/framework/package/server.ts)
- [src/framework/package/vite.ts](C:/projects/hellscript/codex%20version/src/framework/package/vite.ts)

Flach im `src/framework`-Root bleiben bewusst nur noch:

- [shared.ts](C:/projects/hellscript/codex%20version/src/framework/shared.ts)
- [jsx.d.ts](C:/projects/hellscript/codex%20version/src/framework/jsx.d.ts)
- [react-bench-modules.d.ts](C:/projects/hellscript/codex%20version/src/framework/react-bench-modules.d.ts)

## Starten

```bash
npm install
npm run dev
```

Dann `http://localhost:5173` oeffnen.

Build pruefen:

```bash
npm run typecheck
npm run build
npm run build:package
npm run bench
npm run bench:runtime
```

`npm run build` macht jetzt drei Dinge:

- Client-Bundle bauen
- SSR-Bundle fuer das Rendering erzeugen
- `dist/index.html` mit prerendered App-HTML fuellen

Im Dev-Server (`npm run dev`) wird ohne handgeschriebenes Demo-HTML normal gemountet. Im Build-Output wird dagegen echtes prerendered Markup erzeugt, das der Client anschliessend hydriert.

`npm run bench` fuehrt den aktuellen Mikro-Benchmark-Harness fuer Counter-, Tabellen- und Listen-Pfade ueber Vitest Bench aus, inklusive lokaler Vergleichsbasis gegen naive Direkt-DOM-Updates, Vue und React. Eine belastbare Solid-Baseline ist im aktuellen Vitest-/happy-dom-Setup noch offen.

`npm run bench:runtime` ist der robustere Vergleichslauf ausserhalb von Vitest. Er nutzt feste Iterationen und mehrere Runden pro Szenario und schreibt die Ergebnisse nach `bench-runtime-results.json`.

## Als Paket benutzen

Der Repo-Build und der Paket-Build sind absichtlich getrennt:

- `npm run build` baut Demo, SSR und Prerender-Output
- `npm run build:package` baut die konsumierbaren Paket-Artefakte nach `dist/package`

Die aktuellen Paket-Entrypoints sind:

- `hel` oder `hel/runtime`
- `hel/server`
- `hel/vite`

Lokal in einem zweiten Projekt geht das im Moment z. B. so:

```bash
# im Hel-Repo
npm install
npm run build:package

# im anderen Projekt
npm install ../hel
```

Beispiel-Imports:

```ts
import { mount, h } from "hel";
import { renderToString } from "hel/server";
import { helMagicPlugin } from "hel/vite";
```

Ein verifizierter externer Consumer liegt jetzt auch direkt im Repo:

- [starter](C:/projects/hellscript/codex%20version/starter)
- [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)

Der Starter wird bewusst als eigenes kleines Projekt gebaut und typgeprueft, statt nur gegen interne Source-Aliases zu laufen.

`starter` ist der kleinste Client-Only-Consumer.

`starter-ssr` zeigt den aktuellen SSR-Pfad als externes Projekt:

- `hel/runtime` im Client-Build
- `hel/server` im SSR-Build
- Prerender-Schritt ueber eine kleine `entry-server.tsx`

Wichtig fuer externe SSR-Consumer:

- der Client-Code importiert weiterhin normal aus `hel/runtime`
- der SSR-Build muss `hel/runtime` auf `hel/server` aliasen
- das ist im Beispiel in [starter-ssr/vite.config.ts](C:/projects/hellscript/codex%20version/starter-ssr/vite.config.ts) bereits korrekt verdrahtet

Zur schnellen Paketpruefung gibt es jetzt ausserdem:

```bash
npm run verify:package
```

Das baut das Paket und prueft danach beide externen Consumer (`starter` und `starter-ssr`) gegen die veroeffentlichte Paketoberflaeche.

Wenn das Paket bereits gebaut ist, reicht auch:

```bash
npm run verify:starters
```

Wichtig:

- der aktuelle Paket-Build ist ESM-only
- vor lokalem Installieren sollte `npm run build:package` gelaufen sein
- das Repo ist noch kein finaler Release-Kandidat, aber die Paketstruktur ist jetzt erstmals konsumierbar

## Wie man es benutzt

### 1. Komponenten in PascalCase schreiben

```tsx
export function Counter() {
  let count = 0;

  function increment() {
    count++;
  }

  return <button onClick={increment}>Count: {count}</button>;
}
```

Unterstuetzt sind aktuell:

- `function Counter() {}`
- `const Counter = () => {}`
- `const Counter = function () {}`

Der Compiler transformiert nur Komponenten mit PascalCase-Namen.

### 2. `let` ist reaktiver lokaler State

Alles, was im Komponenten-Scope als `let` deklariert wird, wird als mutable reactive cell behandelt.

```tsx
export function Counter() {
  let count = 0;
  let step = 1;

  function increment() {
    count += step;
  }

  return (
    <>
      <button onClick={increment}>Count: {count}</button>
      <button onClick={() => (step = step === 1 ? 2 : 1)}>Step: {step}</button>
    </>
  );
}
```

Unterstuetzt sind auch:

- `count = 1`
- `count += 2`
- `count ||= 1`
- `count ??= 1`
- `count++`, `count--`

Nicht unterstuetzt in diesem Stand:

- Destructuring bei reaktiven `let`-Deklarationen
- Komponenten-Parameter, die kein einfacher Identifier sind

Bei reaktivem `let`-Destructuring wirft der Compiler jetzt bewusst einen klaren Fehler, statt still kaputten Code zu erzeugen.

Dasselbe gilt aktuell fuer:

```tsx
function TodoCard({ todo }) {
  return <article>{todo.title}</article>;
}
```

Im aktuellen Stand sollst du stattdessen ein `props`-Identifier annehmen und innerhalb der Funktion destructuren:

```tsx
function TodoCard(props) {
  const { todo } = props;
  return <article>{todo.title}</article>;
}
```

Default-Parameter und Rest-Parameter fuer Komponenten werden im aktuellen Stand ebenfalls bewusst mit einem klaren Compiler-Fehler blockiert.

### 3. Normale Helper-Funktionen funktionieren

Du kannst normale lokale Funktionen oder `const`-Arrow-Functions schreiben. Wenn sie reaktive `let`-Bindings lesen, erkennt der Compiler das und verdrahtet den Aufruf in einen reaktiven Slot.

```tsx
export function Counter() {
  let count = 0;

  function isEven() {
    return count % 2 === 0;
  }

  function label() {
    return isEven() ? "Even" : "Odd";
  }

  const summary = () => `${count} clicks`;

  return (
    <>
      <p>{label()}</p>
      <p>{summary()}</p>
    </>
  );
}
```

Das ist ein wichtiger Unterschied zu einfacheren Ansatzen, die nur direkte JSX-Reads reaktiv machen.

### 4. `const` bleibt normales TypeScript

`const` wird nicht in State umgeschrieben.

```tsx
const factor = 2;
const doubled = () => count * factor;
```

Das funktioniert, weil `doubled()` beim Ausfuehren reaktiven State liest.

Was aktuell **nicht** passiert:

```tsx
const doubled = count * 2;
```

Das wird **nicht** zu einem gecachten `memo` oder `computed`. Es ist einfach ein normaler Ausdruck zur Renderzeit.

### 5. JSX bleibt direkt und ohne VDOM

```tsx
return (
  <main>
    <button disabled={count === 0} onClick={() => (count = 0)}>
      Reset
    </button>
    {count > 0 ? <p>{count}</p> : <p>empty</p>}
  </main>
);
```

Der Compiler erzeugt daraus direkte DOM-Aufrufe und spezialisierte Slots fuer:

- Text
- Attribute/Properties
- Block-Content

### 6. Arrays und Listen

Normale Arrays und `map(...)` funktionieren bereits:

```tsx
<ul>
  {todos.map((todo) => (
    <li>{todo.title}</li>
  ))}
</ul>
```

Das ist aktuell die **unkeyd** Listen-Variante. Sie ist okay fuer einfache Faelle, ersetzt aber bei strukturellen Aenderungen eher grober.

Wenn du stabile Keys und DOM-Wiederverwendung bei Reorder willst, nutze die explizite `list(...)`-API:

```tsx
import { list } from "hel/runtime";

<ul>
  {list(
    () => todos,
    (todo) => todo.id,
    (todo) => <li>{todo.title}</li>,
  )}
</ul>
```

Aktuelle Semantik von `list(...)`:

- keyed DOM-Wiederverwendung bei Reorder
- SSR/Hydration-kompatibel
- jedes Item muss genau **einen** Root-Node rendern
- bewusst noch eine Runtime-API, keine Compiler-Magie

Pragmatisch heisst das:

- `map(...)` fuer einfache Listen
- `list(...)` fuer stabile, keyed Listen
- optional `For` als Control-Flow-Helper ueber beiden Stilen

```tsx
import { For } from "hel/runtime";

<ul>
  <For each={todos} key={(todo) => todo.id}>
    {(todo) => <li>{todo.title}</li>}
  </For>
</ul>
```

Ohne `key` rendert `For` einfach ueber `map(...)`. Mit `key` nutzt es intern die keyed `list(...)`-Semantik.

`For` kann ausserdem direkt einen leeren Zustand rendern:

```tsx
<For each={todos} fallback={<p>No todos yet.</p>}>
  {(todo) => <TodoRow todo={todo} />}
</For>
```

Fuer Branches gibt es optional auch `Show`:

```tsx
import { Show } from "hel/runtime";

<Show when={visible} fallback={<p>Hidden</p>}>
  <section>Visible</section>
</Show>
```

Normale Ternaries in JSX bleiben ebenfalls der Standard:

```tsx
{visible ? <Panel /> : <Empty />}
```

### 7. Form-Inputs und Todos

Kontrollierte Inputs funktionieren bereits mit normalen Events und `let`-State:

```tsx
let newTitle = "";
let todos = [{ id: "a", title: "Ship Hel", done: false }];

const remainingTodos = () => todos.filter((todo) => !todo.done).length;

function addTodo(event: Event) {
  event.preventDefault();
  todos = [...todos, { id: crypto.randomUUID(), title: newTitle, done: false }];
  newTitle = "";
}
```

Der aktuelle Stil ist dabei bewusst einfach:

- `todos = [...todos, next]`
- `todos = todos.map(...)`
- `todos = todos.filter(...)`
- oder lokaler Proxy-Store mit Mutationen

Ein tiefer offizieller Store mit eigener Setter-API wie `setTodos(i, "done", true)` ist weiterhin absichtlich nicht Teil des Core.

### 8. Minimaler Tiefer Store

Fuer Arrays und Objekte gibt es jetzt zusaetzlich einen kleinen Proxy-Store:

```tsx
import { store } from "hel/runtime";

const todos = store([
  { title: "Ship Hel", done: false },
]);

todos.push({ title: "Benchmark runtime", done: true });
todos[0].done = true;
todos[0].title = "Ship Hel v0.1";
```

Wichtige Semantik:

- absichtlich grob-granular pro Store
- tiefe Property- und Array-Mutationen triggern Reaktivitaet
- keine feingranulare Property-Dependency-Graphen wie bei Solid Stores
- gut genug fuer kleine bis mittlere lokale Datenstrukturen

Der Compiler erkennt `store(...)`-Reads in JSX und lokalen Helper-Funktionen als reaktive Abhaengigkeiten.

### 9. HTML-First Router

Der aktuelle Router ist bewusst klein:

```tsx
import { createRouter } from "hel/runtime";

const router = createRouter([
  { path: "/", view: () => <Home /> },
  { path: "/todos/:id", view: () => <TodoDetail id={router.params().id} /> },
  { path: "/about", view: () => <About /> },
]);

return (
  <>
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
    </nav>
    {router.view()}
  </>
);
```

Wichtige Semantik:

- normale `<a href>`-Tags sind der Standard
- der Router interceptet nur interne Links, die er selbst kennt
- externe Links, Modifier-Keys und `target` bleiben normales Browser-Verhalten
- `router.view()` liefert direkt einen renderbaren Block
- `router.isActive("/about")` kann direkt in Props verwendet werden
- `router.params()` liefert Route-Parameter fuer den aktuell gematchten Pfad
- `router.query()` liefert die aktuellen Query-Parameter als einfaches Objekt
- `router.navigate(-1)` und `router.navigate(1)` reichen an die Browser-History durch
- JSX-Komponenten mit reaktiven Props laufen im aktuellen Compilerpfad wieder stabil, auch fuer Formular-Subtrees

Beispiel fuer Params:

```tsx
const router = createRouter([
  { path: "/todos", view: () => <Todos /> },
  { path: "/todos/:id", view: () => <TodoDetail id={router.params().id} /> },
]);
```

Beispiel fuer Query-Parameter:

```tsx
const router = createRouter([
  { path: "/todos", view: () => <Todos filter={router.query().filter ?? "all"} /> },
]);
```

Beispiel fuer History-Convenience:

```tsx
<button type="button" onClick={() => router.navigate(-1)}>
  Back
</button>
```

Beispiel:

```tsx
<a href="/about" data-active={router.isActive("/about")}>
  About
</a>
```

Absichtlich noch nicht drin:

- nested routes
- guards
- loader/actions

## Was intern zu was wird

Die User-API ist absichtlich "magisch". Intern landet sie aber auf einer kleinen Runtime.

### `let` wird zu einer Cell

User-Code:

```tsx
let count = 0;
count++;
```

Interne Richtung:

```ts
const __cell_count_0 = __cell(0);
__set(__cell_count_0, __get(__cell_count_0) + 1);
```

Praktisch entspricht das in der Denke einem versteckten `signal()` oder `ref()`, nur mit anderer Runtime-Form.

### Reads werden zu `get(...)`

User-Code:

```tsx
<p>{count}</p>
```

Interne Richtung:

```ts
__h("p", null, __dynText(() => __get(__cell_count_0)));
```

### Writes werden zu `set(...)`

User-Code:

```tsx
count = 10;
count += step;
```

Interne Richtung:

```ts
__set(__cell_count_0, 10);
__set(__cell_count_0, __get(__cell_count_0) + __get(__cell_step_1));
```

### Text-Expressions werden zu Slot-Effekten

User-Code:

```tsx
<p>{count}</p>
```

Interne Richtung:

```ts
__dynText(() => __get(__cell_count_0))
```

Runtime-Semantik:

- erstellt genau einen Text-Node
- registriert einen `effect(...)`
- patched spaeter nur `text.data`

Das ist vom Verhalten her aehnlich zu einem sehr kleinen, impliziten `effect` + Text-Binding.

### Dynamische Props werden zu Attribut-/Property-Slots

User-Code:

```tsx
<button disabled={count === 0}>Reset</button>
```

Interne Richtung:

```ts
__h("button", {
  disabled: __dynAttr(() => __get(__cell_count_0) === 0)
})
```

Runtime-Semantik:

- registriert einen `effect(...)`
- patched spaeter nur das betroffene Attribut bzw. Property

### Dynamische Blöcke werden zu Block-Slots

User-Code:

```tsx
{visible ? <Panel /> : <Empty />}
```

Interne Richtung:

```ts
__branch(() => __get(__cell_visible_0), () => __h(Panel, null), () => __h(Empty, null))
```

Runtime-Semantik:

- markiert einen DOM-Bereich
- ersetzt nur diesen Bereich, nicht den gesamten Parent

## Was wird zu `signal`, `effect`, `memo`?

Kurz gesagt:

| User-Code-Idee | Interne Entsprechung im aktuellen Prototyp |
| --- | --- |
| `let count = 0` | `cell(0)` |
| `count` lesen | `get(cell)` |
| `count = ...`, `count++` | `set(cell, ...)` |
| `{count}` in JSX | `dynText(() => get(cell))` plus interner `effect(...)` |
| `disabled={count === 0}` | `dynAttr(() => ...)` plus interner `effect(...)` |
| `{visible ? <A/> : <B/>}` | spezialisierter `branch(...)`-Slot plus interner `effect(...)` |
| `const helper = () => count * 2` | normaler Helper, der bei Aufruf `get(cell)` liest |
| `memo(() => count * 2)` | aktuell **kein direktes Gegenstueck** |

Wichtig:

- Ein explizites `signal()` im User-Code gibt es nicht.
- Ein explizites `effect()` im User-Code gibt es nicht.
- Ein explizites `memo()` im User-Code gibt es auch nicht.
- Die Rolle von `effect()` uebernimmt die Runtime implizit pro Slot.
- Die Rolle von `signal()` uebernehmen die compiler-erzeugten `cell/get/set`-Zugriffe.
- Fuer `memo()` gibt es aktuell nur die pragmatische Form "normaler Helper, der bei Bedarf neu berechnet wird".

Das heisst: Ein Helper wie

```tsx
const doubled = () => count * 2;
```

ist semantisch eher ein **uncached derived getter** als ein echtes `memo`.

## Performance-Eigenschaften des aktuellen Stands

Der aktuelle Stand achtet bereits auf ein paar wichtige Dinge:

- Fine-grained Subscription Tracking in der Runtime
- Microtask-Scheduler statt synchroner Cascade-Updates
- Text-Slots patchen nur Text-Nodes
- Attr-Slots patchen nur das jeweilige Attribut/Property
- Nur echte Strukturwechsel laufen ueber Block-Slots
- Conditional-Toggles laufen im Hot Path ueber spezialisierte Branch-Slots statt generischem `dynBlock(...)`
- keyed `list(...)` kann DOM-Nodes bei Reorder wiederverwenden
- Kein Virtual DOM

Was noch fehlt:

- gecachte derived values / echtes `memo`
- optimierte Template-Cloning-Pfade fuer statische Teilbaeume

## Aktuelle Grenzen

- Nur PascalCase-Komponenten werden transformiert.
- Nur `let` wird automatisch zu reactive state.
- Destructuring fuer reactive `let` ist noch nicht implementiert.
- Lokale Funktionsanalyse ist bewusst konservativ und nur intra-component.
- Hydration deckt aktuell den vorgesehenen Happy Path samt Mismatch-Fallback ab, aber nicht jede strukturelle Randbedingung.
- Der eingebaute `store(...)` ist bewusst grob-granular und lokal.
- `list(...)` ist noch die offizielle keyed Story; automatische keyed Compiler-Erkennung gibt es noch nicht.

## Relevante Dateien

- `src/framework/compiler/plugin.ts`: AST-Transform fuer Komponenten, `let`, Helper-Analyse und JSX-Slots
- `src/framework/compiler/metrics.ts`: Compiler-Metriken fuer Transform-Ausgaben
- `src/framework/runtime/index.ts`: Public Runtime-API und DOM-Entry-Punkte
- `src/framework/runtime/*`: aufgeteilte Runtime fuer Core, DOM, Patching, Slots, Router und Hydration
- `src/framework/server/index.ts`: Public SSR-API
- `src/framework/server/*`: aufgeteilter Server-Renderer und SSR-Router
- `src/framework/package/*`: Paket-Entrypoints fuer Runtime, SSR und Vite-Plugin
- `scripts/build-package.mjs`: JS-Build fuer die veroeffentlichbaren Paketartefakte
- `tsconfig.package.json`: Declaration-Build fuer die Paket-Typen
- `src/demo/App.tsx`: Demo-App mit Router, Store und Todo-Workspace
- `src/demo/pages/*`: aufgeteilte Demo-Seiten
- `src/demo/components/*`: wiederverwendete Demo-Bausteine
- `docs/M2-DESIGN.md`: Architektur und naechste Schritte Richtung Hydration/SSR
