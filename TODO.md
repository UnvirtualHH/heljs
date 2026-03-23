# TODO

Roadmap von aktuellem Prototyp zu einem produktionsreifen Framework.

Status heute:

- Compiler-first Transform fuer `let`-State, JSX und lokale Helper-Funktionen
- direkte DOM-Runtime ohne Virtual DOM
- SSR-HTML-Output
- Hydration-MVP fuer den Happy Path
- Vite-basierter Dev- und Build-Flow

Was das noch nicht ist:

- kein stabiles Production-Framework
- keine abgesicherte API
- keine breite Testabdeckung
- keine belastbare Performance- oder Kompatibilitaetsbasis

## Phase 1: Correctness zuerst

Ziel: Reaktivitaet, DOM-Updates, SSR und Hydration muessen in den Kernfaellen deterministisch korrekt sein.

### Compiler

- [ ] Transform-Regeln fuer `let` weiter absichern
  - Scope-Schattening
  - verschachtelte Closures
  - Schleifen und Branches
  - Default-Parameter und Rest-Parameter
- [x] Destructuring-Strategie festlegen
  - entweder sauber implementieren
  - oder explizit als Fehler mit klarer Compiler-Meldung blocken
- [ ] Offizielle Escape-Hatches einfuehren
  - `noTrack(...)` oder Compiler-Pragma
  - dokumentierte Semantik fuer Hot Paths und Fremdobjekte
- [ ] Compiler-Diagnostik ergaenzen
  - unklare Transform-Faelle
  - nicht unterstuetzte Syntax
  - Hydration-relevante Warnungen

### Runtime

- [x] Hydration-Mismatch-Erkennung einbauen
  - dev: sichtbare Warnung mit Pfadinfo
  - prod: lokaler Fallback-Remount
- [x] Claiming fuer Fragmente und Multi-Root-Komponenten haerten
- [x] Boolean-/Property-/Attribute-Semantik vereinheitlichen
- [ ] Event-Binding-Verhalten stabilisieren
  - keine doppelten Listener
  - keine verlorenen Listener nach Block-Wechseln
- [ ] Cleanup und Lifecycle-Regeln definieren
  - wann Effects verschwinden
  - was bei entfernten Block-Slots passiert
- [x] Reaktive Props durch Function-Components sauber definieren

### SSR/Hydration

- [ ] SSR- und Client-Semantik angleichen
  - Text
  - Attribute
  - Block-Slots
  - Fragments
- [ ] Deterministischen Marker-Contract festschreiben
- [ ] Harte Tests fuer SSR -> Hydration -> Update-Kette bauen
- [ ] Client- und Server-Renderer auf strukturelle Aequivalenz pruefen

### Gate fuer Phase 1

- [ ] 0 bekannte Reproduktionsfaelle mit doppeltem DOM oder leerem Tree
- [ ] 0 bekannte Reproduktionsfaelle mit inkorrekten Post-Hydration-Updates
- [ ] Compiler erzeugt fuer nicht unterstuetzte Syntax klare Fehler statt stiller Fehlsemantik

## Phase 2: Testbasis und Qualitaet

Ziel: Das Framework darf nicht mehr nur manuell verifiziert werden.

### Compiler-Tests

- [x] Snapshot-Tests fuer Transform-Ausgaben
- [ ] Semantik-Tests fuer:
  - Reads
  - Writes
  - Prefix/Postfix
  - logische Assignments
  - [x] Helper-Funktionsanalyse
  - [x] statische vs. dynamische Slot-Entscheidung
- [ ] Negative Tests fuer ungueltige oder noch nicht unterstuetzte Syntax

### Runtime-Tests

- [x] DOM-Tests fuer Text-Slots
- [x] DOM-Tests fuer Attr-Slots
- [x] DOM-Tests fuer Block-Slots
- [x] Tests fuer Fragment-/Multi-Root-Komponenten
- [x] Cleanup-Tests fuer entfernte Teilbaeume

### SSR/Hydration-Tests

- [x] String-Renderer-Snapshots
- [x] Hydration-Tests gegen prerendered HTML
- [x] Mismatch-Fallback-Tests
- [x] Event-Rebinding-Tests nach Hydration

### Tooling

- [x] Test-Runner sauber einziehen
  - bevorzugt Vitest
- [x] Headless DOM-Testumgebung festlegen
  - `happy-dom` oder `jsdom`
- [x] CI-Basis definieren
  - typecheck
  - test
  - build

### Gate fuer Phase 2

- [ ] Kernpfade automatisiert getestet
- [ ] CI laeuft auf jedem Commit gruen
- [ ] Regressionsfaelle lassen sich ueber Tests reproduzieren

## Phase 3: Performance-Foundation

Ziel: Nicht Solid-Level, aber klar besser als ein naiver DOM-Ansatz.

### Compiler

- [ ] Statische Teilbaeume erkennen
- [ ] Template-Cloning fuer statische Strukturen vorbereiten
- [ ] Unnoetige `dyn*`-Wrapper weiter reduzieren
- [ ] Closure-Allokationen im Output messen und senken

### Runtime

- [ ] Template-Instanziierung fuer statische Elemente einfuehren
- [ ] Block-Updates feiner machen
  - heute oft kompletter Slot-Replacement
  - spaeter kleinere DOM-Mutationen
- [ ] Internes Batch-Modell haerten
- [ ] Subscription- und Effect-Overhead messen

### Benchmarks

- [ ] Mikro-Benchmarks bauen
  - Counter
  - Tabellenupdates
  - Listen-Toggle
  - grosse statische Teilbaeume
- [ ] Vergleichsbasis definieren
  - Vue
  - Solid
  - naive DOM-Variante
- [ ] Performance-Budget festlegen
  - Initial Render
  - Hydration
  - Update-Latenz
  - Speicherverbrauch

### Gate fuer Phase 3

- [ ] Keine offensichtlichen O(n)-Katastrophen in Standardpfaden
- [ ] Messbare Verbesserung gegenueber dem aktuellen Prototyp
- [ ] Hydration und Updates bleiben auch unter Last stabil

## Phase 4: API und Sprachmodell scharfziehen

Ziel: Das Framework soll fuer Nutzer vorhersehbar werden.

### Semantik

- [ ] Exakte Regeln fuer reaktive `let` dokumentieren
- [ ] Regeln fuer `const`-Helper und derived values dokumentieren
- [ ] Entscheidung treffen: echtes `memo` intern oder weiter bewusst nicht
- [ ] Entscheidung treffen: keyed Listen als Primitive oder Compiler-Pattern
- [ ] Entscheidung treffen: was absichtlich nicht magisch wird

### User-Facing API

- [ ] Offiziellen Einstieg definieren
  - `mount`
  - `hydrate`
  - SSR-Render-Funktion
- [ ] Paketstruktur festlegen
  - Core
  - Vite-Plugin
  - SSR
- [ ] Fehler- und Warnformat standardisieren

### TypeScript

- [ ] JSX-Typing haerten
- [ ] Event-Typing verbessern
- [ ] Component-Props sauber typisieren
- [ ] Public Types fuer Runtime und SSR exportieren

### Gate fuer Phase 4

- [ ] README reicht nicht mehr nur fuer Demo, sondern fuer echte Nutzung
- [ ] API ist klein, klar und versionierbar
- [ ] Semantik ist fuer Nutzer an konkreten Beispielen erklaert

## Phase 5: Features, die man real braucht

Ziel: Von "coolem Prototyp" zu "damit kann man Dinge bauen".

### Rendering-Features

- [x] keyed List-Reconciliation
- [ ] offizielle Listen-Story
  - Compiler-Pattern
  - [x] Helper
  - Control-Flow-Komponente
- [ ] bessere Fragment-Unterstuetzung ueber alle Pfade
- [x] kontrollierte Form-Elemente testen und haerten
  - `input`
  - `textarea`
  - `select`
  - `checkbox` / `radio`

### State-Features

- [ ] Entscheidung treffen zu Stores / tiefer Objekt-Reaktivitaet
- [ ] optional internes `memo`/derived-Caching evaluieren
- [ ] Async-/Resource-Story definieren
  - absichtlich nicht
  - oder minimaler offizieller Weg

### Ecosystem

- [ ] Devtools-Strategie skizzieren
- [ ] Source-Maps und Fehlermeldungen fuer Compiler-Ausgaben haerten
- [x] Beispiel-App bauen, die mehr als einen Counter zeigt

### Gate fuer Phase 5

- [ ] Mindestens eine kleine echte App laesst sich ohne Workarounds bauen
- [ ] Listen, Formulare und mehrstufige Komponentenbaeume funktionieren stabil

## Phase 6: Packaging, Release und Kompatibilitaet

Ziel: Das Ding muss veroeffentlichbar und konsumierbar sein.

### Packaging

- [ ] `exports`-Map sauber definieren
- [ ] ESM-first Release sauber aufsetzen
- [ ] ggf. CJS-Story bewusst ausschliessen oder separat loesen
- [ ] Versionierung und Changelog-Strategie festlegen

### Tooling-Integration

- [ ] Vite-Plugin oeffentlich konsumierbar machen
- [ ] Minimalbeispiel fuer SSR-Integration bereitstellen
- [ ] Templates / Starter erzeugen

### Browser und Plattformen

- [ ] Browser-Support-Matrix definieren
- [ ] Hydration und DOM-Features gegen Zielbrowser pruefen
- [ ] Node-Versionen fuer SSR-Build festlegen

### Release-Engineering

- [ ] CI/CD fuer Releases
- [ ] automatisierte Paketpruefung vor Publish
- [ ] Semver-Regeln festlegen

### Gate fuer Phase 6

- [ ] Framework kann als Paket installiert und in neuem Projekt genutzt werden
- [ ] Release-Prozess ist reproduzierbar
- [ ] Support-Matrix ist dokumentiert

## Phase 7: Production Readiness

Ziel: Nicht nur "funktioniert bei mir", sondern belastbar unter Fremdnutzung.

### Stabilitaet

- [ ] Bug-Backlog aufraeumen
- [ ] Crash- und Edge-Case-Telemetrie fuer Beispielprojekte sammeln
- [ ] Migrations- und Breaking-Change-Policy definieren

### Dokumentation

- [ ] Getting Started
- [ ] API-Referenz
- [ ] SSR/Hydration-Guide
- [ ] Reaktivitaetsmodell
- [ ] Performance-Guide
- [ ] Grenzen und Nicht-Ziele

### Adoption

- [ ] 2-3 reale Beispielprojekte bauen
- [ ] Feedback aus echter Nutzung einarbeiten
- [ ] API erst danach als `1.0` festziehen

### Finales Go-Live-Gate

- [ ] gruenes CI
- [ ] solide Testabdeckung in Compiler, Runtime und SSR
- [ ] dokumentierte und nachvollziehbare Hydration-Semantik
- [ ] keine bekannten kritischen Correctness-Bugs
- [ ] reproduzierbare Performance-Benchmarks
- [ ] funktionierende Paketierung und Release-Pipeline

## Reihenfolge, wenn wir pragmatisch bleiben

Wenn wir strikt nach Hebel gehen, ist die sinnvolle Reihenfolge:

1. Hydration-Mismatch-Handling und Correctness-Luecken schliessen
2. Testsuite fuer Compiler, Runtime und SSR aufbauen
3. Template-/Static-Tree-Optimierungen fuer Performance
4. keyed Listen und Formular-/DOM-Edge-Cases
5. API-, Packaging- und Release-Haertung
6. reale Apps bauen und nur daraus die 1.0-Semantik ableiten
