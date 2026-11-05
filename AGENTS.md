# Kotori — Agent Guidelines

Kotori is an Nx + `pnpm` TypeScript monorepo built on [Effect](https://effect.website), Drizzle ORM (Postgres 18), and Expo (Router).

## Workspace Layout & Data Flow

```text
packages/db         → Drizzle tables, JSONB schemas, and forward-only migrations (`packages/db/migrations`)
packages/contracts  → HTTP contract (`KotoriApi`), request/response schemas derived from `@kotori/db`, public errors
packages/language   → Japanese/English text utilities (rōmaji ↔ kana, deinflection, furigana, phrase normalization)
packages/srs        → Pure Anki SM-2 (v3) spaced-repetition scheduler
packages/ai         → Claude, Jev, and ElevenLabs integrations + golden evaluations
apps/backend        → HTTP API, enrichment worker, `kotori` CLI, and admin console (`src/entrypoints/{http,worker,cli}.ts`, `console.tsx`)
apps/app            → Expo Router app for iOS, Android, and web
tools/local-auth    → Local stand-in for Neon Managed Better Auth (:4001)
```

- **Schema-first flow**: Queries in `@kotori/backend` and wire schemas in `@kotori/contracts` derive from `@kotori/db` tables, and `@kotori/app` is typed by `@kotori/contracts`. After changing `packages/db/src`, generate migrations with `pnpm --filter @kotori/db generate` (verified in CI by `pnpm nx run @kotori/db:check`).
- **Admin console**: `pnpm kotori` with no arguments opens an OpenTUI terminal UI over the CLI (`apps/backend/src/console`). It runs on Node 26 with `--experimental-ffi`, fetched by `pnx` in the backend's `console` script; its packages (`@opentui/*`, `react`) are devDependencies, absent from the Fly image, so nothing outside `src/console` and `src/entrypoints/console.tsx` may import them. Its jobs list is built from the CLI's own command definitions, so a new command or flag appears there without console changes. Keep logic in `src/console/model` (tested on the repo's Node by Vitest) and out of the views, which only OpenTUI can render.
- **Module boundaries**: Enforced by `@nx/enforce-module-boundaries` in `.oxlintrc.json`. Shared and client packages (`packages/db`, `packages/contracts`, `packages/language`, `packages/srs`, `apps/app`) must stay runtime-agnostic — no Node.js built-ins (`import/no-nodejs-modules`) or database drivers (`pg`, `@effect/sql-*`).

## Running Tasks with Nx

Always run tasks through `pnpm nx` (or the root `package.json` scripts) rather than invoking underlying tools directly:

```sh
pnpm test                                              # Vitest + @effect/vitest across all projects
pnpm typecheck                                         # TypeScript 7 (`tsc --build`) across all projects
pnpm lint                                              # Type-aware Oxlint + module boundary checks
pnpm format                                            # Format with Oxfmt (`pnpm format:check` in CI)
pnpm nx affected -t lint typecheck test build check    # Run full CI checks on affected projects
pnpm nx run <project>:<target>                         # Run a single project target (e.g. `@kotori/backend:test`)
```

- **Inferred targets**: `typecheck`, `build`, and `lint` are inferred by `@nx/js/typescript` and `@nx/oxlint` in `nx.json` rather than listed in every `package.json`. Inspect a project's resolved targets with `pnpm nx show project <project> --json`.
- **Workspace linking & TypeScript project references**: Add internal dependencies with `pnpm add @kotori/<pkg> --filter <consumer> --workspace`, then run `pnpm sync` (`pnpm nx sync`) so `tsconfig` project references stay in sync (checked in CI via `pnpm nx sync:check`).
- **Tests require no external services**: Database tests run against in-process PGlite (`@effect/sql-pglite`) and auth tests use an in-memory fake — no Docker container, running server, or API keys are needed to run `pnpm test`.
