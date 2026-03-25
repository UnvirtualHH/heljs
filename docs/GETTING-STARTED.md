# Getting Started

`Hel` ist aktuell ein compiler-first Framework-Prototyp mit:

- lokalem `let`-State
- direktem DOM statt Virtual DOM
- kleinem HTML-first Router
- SSR + Hydration
- Vite-Plugin fuer den AST-Transform

Der schnellste Einstieg ist erst lokal gegen das Paket zu arbeiten und nicht direkt gegen interne Source-Dateien.

## Voraussetzungen

- Node.js 22
- npm

## 1. Hel im Framework-Repo bauen

Im Hel-Repo:

```bash
npm install
npm run build:package
```

Das erzeugt die konsumierbaren Paketartefakte unter `dist/package`.

## 2. Neues Client-Projekt anlegen

Minimaler `package.json`-Ausschnitt:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hel": "file:../hel"
  }
}
```

## 3. Vite einrichten

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { helMagicPlugin } from "hel/vite";

export default defineConfig({
  plugins: [helMagicPlugin()],
});
```

## 4. Eine erste Komponente schreiben

`src/main.tsx`:

```tsx
import { h, mount } from "hel/runtime";

function App() {
  let count = 0;

  return (
    <main>
      <h1>Hel Starter</h1>
      <button onClick={() => count++}>Count: {count}</button>
    </main>
  );
}

mount(<App />, document.getElementById("app")!);
```

Wichtig:

- Komponenten muessen PascalCase haben
- lokaler reaktiver State ist `let`
- normale `const`-Helper sind okay
- kein `signal()`, `effect()` oder `memo()` im User-Code

## 5. Dev-Server starten

```bash
npm run dev
```

## Router-Minimum

```tsx
import { createRouter, h, mount } from "hel/runtime";

const router = createRouter([
  { path: "/", view: () => <h1>Home</h1> },
  { path: "/about", view: () => <h1>About</h1> },
]);

function App() {
  return (
    <>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      {router.view()}
    </>
  );
}
```

Normale `<a href>`-Tags sind der Standard. Der Router interceptet nur interne bekannte Routen.

## SSR-Minimum

Fuer SSR gibt es im Repo bereits ein funktionierendes Beispiel:

- [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)

Wichtiger Punkt fuer externe SSR-Projekte:

- Client-Code importiert aus `hel/runtime`
- der SSR-Build muss `hel/runtime` auf `hel/server` aliasen

Das ist im Beispiel in [starter-ssr/vite.config.ts](C:/projects/hellscript/codex%20version/starter-ssr/vite.config.ts) bereits umgesetzt.

## Verifizierte Beispiele im Repo

- Client-only Starter:
  - [starter](C:/projects/hellscript/codex%20version/starter)
- SSR-Starter:
  - [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)
- groessere Demo-App:
  - [src/demo](C:/projects/hellscript/codex%20version/src/demo)

## Bekannte Grenzen

- `let`-Destructuring fuer reaktiven State ist noch nicht implementiert
- Komponenten-Parameter muessen aktuell ein einfacher Identifier sein
- `list(...)` ist die offizielle keyed Listen-Story
- `store(...)` ist bewusst lokal und grob-granular
- der Router ist absichtlich klein: keine nested routes, guards oder loader/actions

## Sinnvolle naechste Dokumente

- Architektur:
  - [M2-DESIGN.md](C:/projects/hellscript/codex%20version/docs/M2-DESIGN.md)
- Release-/Publish-Guide:
  - [RELEASING.md](C:/projects/hellscript/codex%20version/docs/RELEASING.md)
