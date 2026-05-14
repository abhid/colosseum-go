# Colosseum UI

React + TypeScript operator UI for Colosseum. The production build is embedded into the Go binary by `make build`.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

From the repository root, `make dev` runs the Go API and Vite dev server together.

## Structure

- `src/pages`: route-level screens.
- `src/components`: shared UI and feature components.
- `src/lib/api.ts`: API client wrappers.
- `src/lib/queryKeys.ts`: TanStack Query cache keys.
- `tests`: Playwright visual tests.

## Development Notes

The Vite dev server proxies `/api` to the Go server on `localhost:8080`. Run `make build` before testing the embedded UI path served by the Go binary.
