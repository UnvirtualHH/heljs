# Releasing Hel

Der Release-Pfad ist jetzt so aufgebaut, dass ein npm-Release nicht mehr auf manuelle Einzelbefehle angewiesen ist.

## Voraussetzungen

- npm-Paketname und Version sind in [package.json](C:/projects/hellscript/codex%20version/package.json) korrekt
- `NPM_TOKEN` ist als GitHub Actions Secret gesetzt
- der Arbeitsbaum ist sauber

## Lokaler Release-Check

Vor jedem Tag:

```bash
npm install
npm run release:check
```

Das macht:

1. `typecheck`
2. `test`
3. normalen App-/SSR-Build
4. Paket-Build
5. externe Consumer-Verifikation:
   - [starter](C:/projects/hellscript/codex%20version/starter)
   - [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)
6. `npm pack --dry-run`

Wenn du nur die Consumer gegen ein bereits gebautes Paket pruefen willst:

```bash
npm run verify:starters
```

## GitHub Actions

Es gibt zwei relevante Workflows:

- CI:
  - [ci.yml](C:/projects/hellscript/codex%20version/.github/workflows/ci.yml)
- Release:
  - [release.yml](C:/projects/hellscript/codex%20version/.github/workflows/release.yml)

### CI

CI prueft auf Push/PR:

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run build:package`
- `npm run verify:starters`

### Release

Der Release-Workflow laeuft bei:

- Tag-Push `v*`
- `workflow_dispatch`

`verify-and-pack`:

- installiert Dependencies
- fuehrt `npm run release:check` aus
- packt ein `.tgz`-Artefakt
- laedt dieses als Workflow-Artefakt hoch

`publish-npm`:

- laeuft nur auf Tag-Pushes
- laedt das gepackte Artefakt herunter
- published mit:

```bash
npm publish artifacts/*.tgz --access public --provenance
```

## Empfohlener Release-Ablauf

1. Version in [package.json](C:/projects/hellscript/codex%20version/package.json) anheben
2. lokal `npm run release:check`
3. committen
4. Tag setzen, z. B.:

```bash
git tag v0.1.1
git push origin main --tags
```

5. Release-Workflow beobachten

## Bewusste Entscheidungen

- ESM-only
- npm-Publish ueber gepacktes Artefakt statt neuem Build im Publish-Job
- Consumer-Pruefung ist Teil des Release-Gates
- SSR-Consumer bleibt explizit im Gate, weil genau dort Packaging-/Aliasfehler am ehesten auffallen

## Noch nicht Teil des Release-Prozesses

- automatisches Changelog
- GitHub Release Notes
- Changesets/Semver-Automation
- CJS-Output

Wenn diese Punkte kommen, sollten sie auf dem bestehenden `release:check` aufbauen statt eine zweite parallele Pipeline einzufuehren.
