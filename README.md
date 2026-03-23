# Hel

![Hel logo](public/hel-192.png)

Compiler-first Prototyp fuer ein Framework ohne Virtual DOM.

Ziel ist Solid-artige Fine-Grained-Reaktivitaet, aber mit normalem TypeScript im User-Code:

- `let` fuer lokalen State
- normale Funktionen und Closures
- JSX ohne `signal()`, `effect()`, `memo()` im User-Code
- direkte DOM-Updates statt VDOM-Diffing

Der aktuelle Stand ist ein brauchbarer M2-Prototyp mit Client-Rendering, SSR-HTML-Output und Hydration-MVP.

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
npm run bench
```

`npm run build` macht jetzt drei Dinge:

- Client-Bundle bauen
- SSR-Bundle fuer das Rendering erzeugen
- `dist/index.html` mit prerendered App-HTML fuellen

Im Dev-Server (`npm run dev`) wird ohne handgeschriebenes Demo-HTML normal gemountet. Im Build-Output wird dagegen echtes prerendered Markup erzeugt, das der Client anschliessend hydriert.

`npm run bench` fuehrt den aktuellen Mikro-Benchmark-Harness fuer Counter-, Tabellen- und Listen-Pfade ueber Vitest Bench aus.

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
- tiefe Objekt-/Array-Reaktivitaet per Proxy

Bei reaktivem `let`-Destructuring wirft der Compiler jetzt bewusst einen klaren Fehler, statt still kaputten Code zu erzeugen.

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
import { list } from "@hel/runtime";

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

Der aktuelle Stil ist dabei bewusst immutable:

- `todos = [...todos, next]`
- `todos = todos.map(...)`
- `todos = todos.filter(...)`

Tiefe Store-Mutationen wie `setTodos(i, "done", true)` gibt es in Hel aktuell noch nicht.

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
__dynBlock(() => __get(__cell_visible_0) ? __h(Panel, null) : __h(Empty, null))
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
| `{visible ? <A/> : <B/>}` | `dynBlock(() => ...)` plus interner `effect(...)` |
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
- Hydration deckt aktuell den vorgesehenen Happy Path ab, aber noch keine harte Mismatch-Diagnostik.
- Kein offizieller Store fuer tiefe Objekt-Reaktivitaet.
- `list(...)` ist noch die offizielle keyed Story; automatische keyed Compiler-Erkennung gibt es noch nicht.

## Relevante Dateien

- `src/framework/plugin.ts`: AST-Transform fuer Komponenten, `let`, Helper-Analyse und JSX-Slots
- `src/framework/runtime.ts`: Runtime fuer `cell/get/set`, Scheduler und Text-/Attr-/Block-Slots
- `src/framework/server.ts`: Server-Renderer fuer HTML-Output mit denselben Block-Markern wie die Hydration-Runtime
- `src/App.tsx`: Demo fuer den aktuellen Sprachstil
- `docs/M2-DESIGN.md`: Architektur und naechste Schritte Richtung Hydration/SSR
