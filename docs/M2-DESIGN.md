# M2 Design

Ziel von M2 ist ein compiler-first Framework ohne Virtual DOM, das sich im User-Code wie "normales TypeScript + JSX" anfuehlt:

- `let` fuer lokalen mutable state
- `const` fuer normale Ableitungen und Helper
- keine `signal()`, `memo()`, `effect()` API im User-Code
- direkte DOM-Updates statt VDOM
- SSR/Hydration als echter Pfad, nicht nur Client-Mount

M1 ist dafuer eine brauchbare Basis, aber noch nicht nah genug an der Zielanforderung. M2 schliesst drei Luecken:

1. Reaktivitaet muss auch durch normale Helper-Funktionen und Closures tragen.
2. Hydration muss vorhandenen DOM claimen statt neu zu rendern.
3. Der Compiler braucht klare Regeln fuer `let`, `const`, Captures und dynamische Ausdruecke.

## Zielbild

Beispiel fuer den gewuenschten M2-User-Code:

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

Erwartete Semantik:

- `count` und `step` sind reaktive Zellen.
- `label`, `doubled` und `canReset` bleiben normale Funktionen.
- Wenn diese Funktionen reaktive `let`-Bindings lesen, werden ihre Aufrufe in dynamischen DOM-Slots sauber nachverfolgt.
- Event-Handler schreiben direkt auf dieselben Zellen.
- Bei SSR wird HTML plus Marker erzeugt; bei Hydration werden bestehende Nodes weiterverwendet.

## M2 Architektur

M2 besteht aus drei Ebenen:

1. Compiler
2. Runtime
3. SSR/Hydration-Protokoll

### 1. Compiler

Der Compiler bleibt AST-first, aber bekommt einen expliziten "render graph" statt nur ein blindes Umschreiben von `let` und JSX.

#### 1.1 Komponenten-Erkennung

M2 bleibt fuer den Moment bei PascalCase-Komponenten.

Gruende:

- klare Abgrenzung fuer den Transform
- kompatibel mit JSX-Konventionen
- vermeidet magische Umformung beliebiger Hilfsfunktionen ausserhalb von Komponenten

Unterstuetzte Formen:

- `function Counter() {}`
- `const Counter = () => {}`
- `const Counter = function () {}`

Nicht Ziel von M2:

- automatische Reaktivitaet fuer beliebige Non-Component-Module
- Klassenkomponenten

#### 1.2 Reaktive Bindings

M2-Regel:

- `let` innerhalb eines Komponenten-Scopes wird standardmaessig als reaktives Binding behandelt.
- `const` bleibt lexical und wird nicht zu State umgeschrieben.

Begruendung:

- `let` bildet mutablen State am besten ab.
- `const` soll normale TS-Semantik behalten.
- "const reaktiv machen" fuehrt sehr schnell zu schwer vorhersagbarer Semantik.

Was sich fuer `const` trotzdem verbessert:

- `const helper = () => count * 2` funktioniert, weil der Helper beim Ausfuehren einen reaktiven `let` liest.
- `const view = <div>{count}</div>` wird als JSX-Ausdruck korrekt in einen dynamischen Slot eingebunden.

Nicht in M2:

- `const doubled = count * 2` als automatisch gecachter computed Wert
- implizite inkrementelle Datenflussanalyse fuer jedes `const`

Falls spaeter gewuenscht, ist das ein M3-Thema: compile-time promoted derived values.

#### 1.3 Scope- und Capture-Regeln

M2 fuehrt die folgende Regel ein:

- Ein `let` wird zu `cell(...)`.
- Jeder Read innerhalb des Komponentenbaums wird zu `get(cell)`.
- Jeder Write wird zu `set(cell, ...)`.
- Closures muessen keine Sonder-API verwenden; Captures laufen ueber das normale JS-Closure-Modell auf die umgeschriebenen `cell`-Zugriffe.

Beispiel:

```tsx
let count = 0;

function doubled() {
  return count * 2;
}

return <p>{doubled()}</p>;
```

wird zu:

```ts
const __cell_count_0 = __cell(0);

function doubled() {
  return __get(__cell_count_0) * 2;
}

return __h("p", null, __dyn(() => doubled()));
```

Das ist der Kern, damit "normale Funktionen" wirklich funktionieren.

#### 1.4 Dynamische Ausdruecke

M1 wrappt praktisch jeden JSX-Ausdruck in `dyn(() => expr)`. Das ist einfach, aber zu grob.

M2 trennt zwischen statisch und dynamisch:

- statisch: keine Reads auf reaktive Bindings
- dynamisch: direkter oder indirekter Read auf reaktive Bindings

Compiler-Entscheidung:

- JSX-Text mit reinem Literal bleibt statisch.
- JSX-Expression wird nur dann zu `dyn(...)`, wenn der Ausdruck reaktive Reads enthaelt oder einen Funktionsaufruf enthaelt, der reaktive Reads enthalten kann.
- Event-Props bleiben plain functions.

Konservative M2-Heuristik:

- Wenn ein Ausdruck einen Aufruf einer lokal definierten Funktion enthaelt, behandeln wir ihn als dynamisch, falls diese Funktion innerhalb derselben Komponente irgendein reaktives `let` liest.
- Das darf false positives produzieren.
- False negatives duerfen wir uns hier nicht leisten.

Das ist absichtlich konservativer als M1, aber deutlich naeher an der Zielanforderung.

#### 1.5 Funktions-Analyse

Der Compiler fuehrt fuer jede Komponente eine lokale Funktionsanalyse durch:

- sammle alle `let`-Bindings
- sammle pro lokaler Funktion die gelesenen reaktiven Bindings
- markiere Funktionen als "reactive reader", wenn sie direkt oder transitiv reactive reads enthalten

Algorithmus:

1. Finde alle lokalen Funktionsdeklarationen und Funktionsausdruecke.
2. Baue pro Funktion eine Menge direkter Reads auf reaktive `let`.
3. Baue einen einfachen Call-Graph fuer lokale Funktionsaufrufe.
4. Berechne den transitiven Abschluss "function reads reactive state".
5. Nutze diese Information bei JSX-Expressions und Prop-Expressions.

Grenzen von M2:

- nur lokale, statisch aufloesbare Aufrufe
- kein inter-modulares Dataflow-Tracking
- keine perfekte Alias-Analyse

Das reicht fuer den gewuenschten Stil mit kleinen Helpern in Komponenten.

#### 1.6 Statements und Operatoren

M2 uebernimmt den robusten Teil aus M1:

- `=`
- `+=`, `-=`, `*=`, `/=`, `%=` usw.
- `&&=`, `||=`, `??=`
- `++`, `--` mit korrekter Prefix-/Postfix-Semantik

Zusatz fuer M2:

- `for`- und `while`-Kontexte muessen bei Writes korrekt transformiert werden
- Destructuring bleibt weiterhin explizit ausserhalb des Scopes von M2

#### 1.7 Escape Hatches

M2 braucht eine kleine, klare Opt-out-Regel.

Vorschlag:

- `let raw = noTrack(expr)` bleibt untransformiert
- oder per Kommentar-Pragma `/* @raw */ let temp = ...`

Ziel:

- nicht alles magisch machen
- Workarounds fuer Hot Paths und Fremdobjekte ermoeglichen

Das sollte sparsam bleiben, aber der Compiler braucht einen offiziellen Notausgang.

### 2. Runtime

Die Runtime bleibt fein-granular und DOM-direkt. M2 baut auf der aktuellen `cell/get/set/effect/dyn`-Richtung auf.

#### 2.1 Scheduler

Der Microtask-Scheduler aus M1 bleibt.

Warum:

- natuerliches Batching ohne User-API
- weniger Cascade-Updates
- DOM-Updates werden konsistent gesammelt

M2 fuegt optional eine interne `batch()`-Funktion hinzu, aber nicht als User-API. Die Runtime braucht sie fuer Hydration und DOM-Claiming.

#### 2.2 Dynamic Slots statt Full Child Replacement

M1 ersetzt bei dynamischen Children immer die komplette aktuelle Node-Liste. Das ist ok fuer M1, aber zu grob fuer Hydration und groessere Subtrees.

M2 fuehrt explizite Slot-Typen ein:

- `textSlot(read)`
- `nodeSlot(read)`
- `attrSlot(el, key, read)`
- `blockSlot(read)`

Ziel:

- Text nur als Text patchen
- Attribute nur als Attribute patchen
- Blocks koennen Node-Ranges ersetzen
- dieselben Slots funktionieren bei SSR und Hydration

Interne Struktur:

```ts
type Slot = {
  start: Node;
  end: Node;
  update(): void;
};
```

Ein Text-Slot kann dabei optimiert nur einen Text-Node halten; ein Block-Slot verwaltet einen Marker-Bereich.

#### 2.3 Komponenten-Rueckgaben

M1 verliert bei Function-Components mit mehreren Root-Nodes alle Nodes ausser dem ersten. Das wird in M2 behoben.

Neue Regel:

- `h(Component, props, children)` darf `Node | DocumentFragment | Node[] | primitive` zurueckbekommen.
- Die Runtime normalisiert das vollstaendig zu einem stabilen Node-Range.

Das ist auch fuer Hydration wichtig, weil Komponenten sonst keine konsistente Claiming-Grenze haben.

#### 2.4 DOM-Operationen

M2 fuehrt einen kleinen internen Host-Layer ein:

- `createElement(tag)`
- `createText(value)`
- `insert(parent, node, anchor)`
- `removeRange(start, end)`
- `setProp(el, key, value)`
- `createMarker(name)`

Warum:

- SSR und Client teilen dieselbe Render-Semantik
- Hydration kann gegen denselben abstrakten Ablauf "claim statt create" fahren

### 3. SSR/Hydration-Protokoll

Das ist der wichtigste neue Teil.

#### 3.1 SSR-Format

Der Server rendert HTML direkt und setzt Marker fuer dynamische Bereiche.

Beispiel:

```html
<section class="counter">
  <button><!--hs:slot:0-->0 clicks<!--/hs:slot:0--></button>
  <p>Double: <!--hs:slot:1-->0<!--/hs:slot:1--></p>
  <button><!--hs:attr:2:disabled--></button>
</section>
```

Alternativ fuer Attribute, wenn Kommentar-Marker unpraktisch sind:

- `data-hs-a="2:disabled"`
- `data-hs-s="0"`

Entscheidung fuer M2:

- Node-Dynamik ueber Kommentar-Marker
- Attribut-Hydration ueber `data-hs-*`

Grund:

- HTML-Parsen bleibt robust
- Claiming von Text-/Block-Slots wird einfacher

#### 3.2 Client-Hydration

Statt `mount()` braucht M2 zwei Pfade:

- `mount(factory, target)` fuer reines Client-Rendering
- `hydrate(factory, target)` fuer bestehendes SSR-Markup

Hydration-Algorithmus:

1. Traverse DOM unter `target`.
2. Baue einen Cursor ueber Marker und Elemente.
3. Wenn der Compiler `textSlot` oder `blockSlot` erwartet, claime den passenden Marker-Bereich.
4. Wenn ein statischer Knoten erwartet wird, validiere Tag/Struktur konservativ.
5. Hake Event-Handler ein.
6. Registriere Effects, ohne den DOM initial neu aufzubauen.

Mismatch-Strategie fuer M2:

- in `dev`: Warnung mit Pfadinfo und Fallback auf Client-Remount fuer den kleinsten betroffenen Subtree
- in `prod`: stiller lokaler Remount des betroffenen Subtrees

Wir brauchen keinen globalen Hard-Fail.

#### 3.3 Compiler-Ausgabe fuer SSR/Hydration

Der Compiler erzeugt nicht zwei verschiedene User-APIs, sondern zwei Backends:

- Client backend
- SSR backend

Beide nutzen denselben transformierten Komponentenrumpf.

Beispiel:

```ts
return __template(
  ["<p>Count: ", "</p>"],
  [__slot(() => __get(__cell_count_0))]
);
```

Client:

- erstellt DOM aus Template und registriert Slots

Server:

- serialisiert Strings plus Marker

Hydrator:

- mappt Slots auf vorhandene Marker

Das ist sauberer als JSX nur zu `h(...)` umzuschreiben und spaeter SSR "dranzukleben".

## Empfohlene M2 Arbeitspakete

### Paket 1: Reaktive Helper-Funktionen stabilisieren

Ziel:

- lokale Funktionsanalyse
- transitives Markieren reaktiver Reader
- `dyn()` nur noch fuer wirklich oder potenziell dynamische Expressions

Akzeptanzkriterien:

- `const doubled = () => count * 2` aktualisiert im DOM
- `function label() { return count }` aktualisiert im DOM
- statische JSX-Expressions erzeugen keinen dynamischen Slot

### Paket 2: Runtime auf Slots umstellen

Ziel:

- `mountDynamicChild()` durch Slot-System ersetzen
- Text-, Attribut- und Block-Slots trennen

Akzeptanzkriterien:

- Textupdates ersetzen keine ganzen Teilbaeume mehr
- dynamische Attribute und Booleans verhalten sich stabil
- Komponenten mit Fragment/mehreren Roots funktionieren

### Paket 3: Hydration MVP

Ziel:

- SSR-Markerformat festlegen
- `hydrate()` implementieren
- Claiming fuer Text- und Block-Slots

Akzeptanzkriterien:

- servergerendertes Counter-Beispiel hydriert ohne Full Remount
- Events funktionieren nach Hydration
- erste State-Aenderung patcht vorhandene Nodes

### Paket 4: SSR Compiler-Backend

Ziel:

- Kompilat fuer HTML-Serialisierung plus Marker
- Shared Template/Slot-Modell zwischen SSR und Client

Akzeptanzkriterien:

- dieselbe Komponente kann zu HTML und zu DOM kompiliert werden
- Marker sind deterministisch
- Hydrator kann das Ergebnis eindeutig claimen

## Was M2 bewusst noch nicht loest

- keyed list diffing
- stores/proxies fuer tiefe Objekt-Reaktivitaet
- suspense/async resources
- devtools
- inter-modulare reactive analysis
- automatische computed-Caches fuer `const`-Ausdruecke

Diese Punkte gehoeren in spaetere Milestones.

## Konkrete Compiler-Regeln fuer M2

Kurzfassung:

- `let` im Komponenten-Scope: reaktiv
- `const`: nicht reaktiv umschreiben
- Reads auf reaktive `let`: `get(cell)`
- Writes auf reaktive `let`: `set(cell, next)`
- lokale Funktionen mit reaktiven Reads: als reactive reader markieren
- JSX-Expressions/Props mit reactive reader oder reactive read: `dyn(() => expr)`
- Event-Props: nie `dyn`, immer plain function

Das ist die kleinste Regelmenge, die sich fuer User noch "magisch" anfuehlt, aber fuer den Compiler kontrollierbar bleibt.

## Empfehlung

M2 sollte auf der aktuellen Hel-Codebasis aufsetzen, nicht auf der Claude-Version.

Gruende:

- das Scoping-Modell ist bereits sauberer
- der Scheduler ist bereits brauchbar
- der Compiler ist naeher an einer echten Analyse als an string-basierten Heuristiken
- Vite-Integration beschleunigt die Iteration massiv

Die richtige Richtung ist nicht "weniger Magie", sondern "praeziser kompilierte Magie".
