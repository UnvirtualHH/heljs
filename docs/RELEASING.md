# Releasing Hel

The release path is now set up so that an npm release is no longer a collection of manual one-off commands.

## Prerequisites

- the npm package name and version in [package.json](C:/projects/hellscript/codex%20version/package.json) are correct
- `NPM_TOKEN` is configured as a GitHub Actions secret
- the working tree is clean

## Local Release Check

Before every tag:

```bash
npm install
npm run release:check
```

That runs:

1. `typecheck`
2. `test`
3. the normal app and SSR build
4. the package build
5. external consumer verification:
   - [starter](C:/projects/hellscript/codex%20version/starter)
   - [starter-ssr](C:/projects/hellscript/codex%20version/starter-ssr)
6. `npm pack --dry-run`

If you only want to validate the consumers against an already built package:

```bash
npm run verify:starters
```

## GitHub Actions

There are two relevant workflows:

- CI:
  - [ci.yml](C:/projects/hellscript/codex%20version/.github/workflows/ci.yml)
- Release:
  - [release.yml](C:/projects/hellscript/codex%20version/.github/workflows/release.yml)

### CI

CI verifies on push and pull request:

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run build:package`
- `npm run verify:starters`

### Release

The release workflow runs on:

- tag pushes matching `v*`
- `workflow_dispatch`

`verify-and-pack`:

- installs dependencies
- runs `npm run release:check`
- packs a `.tgz` artifact
- uploads that artifact to the workflow

`publish-npm`:

- only runs on tag pushes
- downloads the packed artifact
- publishes with:

```bash
npm publish artifacts/*.tgz --access public --provenance
```

## Recommended Release Flow

1. bump the version in [package.json](C:/projects/hellscript/codex%20version/package.json)
2. run `npm run release:check` locally
3. commit the change
4. create a tag, for example:

```bash
git tag v0.1.1
git push origin main --tags
```

5. watch the release workflow

## Intentional Decisions

- ESM-only
- npm publish happens from the packed artifact instead of rebuilding inside the publish job
- consumer verification is part of the release gate
- the SSR consumer remains explicitly in the gate because packaging and alias mistakes are most likely to show up there

## Not Yet Part of the Release Process

- automatic changelog generation
- GitHub release notes
- changesets or semver automation
- CJS output

If those arrive later, they should build on the existing `release:check` instead of creating a second parallel release pipeline.
