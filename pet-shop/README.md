# Hel Pet Shop

A real application built on the published Hel package, as a test of whether plain code holds up. What it found is in [docs/PET-SHOP.md](../docs/PET-SHOP.md).

## Run it

Build Hel first, in the repository root:

```bash
npm run build:package
```

Then, in this folder:

```bash
npm install
```

With the development server, which has no SSR and a slow API so loading states show:

```bash
npm run dev
```

With server rendering on port 4300:

```bash
npm run build
```

```bash
npm start
```

To sign in, use `admin` / `admin`. A card number ending in `0000` is declined.

## Test it

```bash
npm test
```

This builds the server bundle first, because the hydration tests run every route against it.

## Where things are

- `server/api.ts`: the API, in memory
- `scripts/serve.mjs`: the production server
- `src/entry-server.tsx`: per-request rendering and what each route preloads
- `src/router.tsx`: the routes
- `src/state`: cart, session, favorites, and toasts, shared through `use*` functions
- `src/lib/api.ts`: `fetch` and `useApi`
- `src/pages`, `src/components`: the UI
