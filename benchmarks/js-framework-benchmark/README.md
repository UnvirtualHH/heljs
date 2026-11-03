# Hel in js-framework-benchmark

The Hel implementation for [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark). It is written the way the docs recommend, with plain `let` state and no benchmark-specific tricks. It cannot go into the official repository yet, because Hel is not published on npm. The results are in [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md).

## Run it

The repository's full checkout fails on Windows because of very long paths, so use a sparse one:

```bash
git clone --depth 1 --no-checkout https://github.com/krausest/js-framework-benchmark.git jfb
```

```bash
cd jfb && git sparse-checkout init --no-cone
```

```bash
printf '%s\n' '/*' '!/retired/' '!/broken-frameworks/' '!/frameworks/non-keyed/' '!/frameworks/keyed/*' '/frameworks/keyed/vanillajs/' '/frameworks/keyed/solid/' '/frameworks/keyed/svelte/' '/frameworks/keyed/vue/' '/frameworks/keyed/react-hooks/' > .git/info/sparse-checkout && git checkout
```

The server expects a `frameworks/non-keyed` folder, so create one with a file in it:

```bash
mkdir -p frameworks/non-keyed && touch frameworks/non-keyed/.keep
```

Install the tooling. The root `npm ci` may fail on an ESLint conflict, which does not matter for running the benchmark:

```bash
npm run install-server && npm run install-webdriver-ts
```

Build every framework you want to compare, with `npm ci && npm run build-prod` in its folder.

For Hel, build the package in this repository with `npm run build:package`, copy the `hel` folder from here to `frameworks/keyed/hel`, and then run this in that folder, with the path to this repository:

```bash
npm install && npm install --no-save <path-to-heljs> && npm run build-prod
```

The server also wants a lock file, so `echo '{}' > package-lock.json` is enough if there is none.

Start the server with `npm start` in the `jfb` folder. In `webdriver-ts`, check that Hel counts as keyed:

```bash
node dist/isKeyed.js --headless --framework keyed/hel
```

Then measure:

```bash
node dist/benchmarkRunner.js --headless --framework keyed/vanillajs keyed/solid keyed/hel keyed/svelte keyed/vue keyed/react-hooks --count 15
```

## Compare runs

`compare.cjs` pools the samples of one or more result folders and prints the medians, plus the weighted geometric mean that the official results table uses for its CPU benchmarks:

```bash
node compare.cjs <results-folder> [<another-results-folder>]
```

Run it at least twice in a different framework order. Between two runs on one machine, a framework's score moved by up to 0.1, which is more than the distance between Solid, Hel, and Svelte.
