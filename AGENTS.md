# Kotori — Agent Guidelines

Kotori is an Nx + `pnpm` TypeScript monorepo built on [Effect](https://effect.website), Drizzle ORM (Postgres 18), and Expo (Router).

## Workspace Layout & Data Flow

```text
packages/db         → Drizzle tables, JSONB schemas, and forward-only migrations (`packages/db/migrations`)
packages/contracts  → HTTP contract (`KotoriApi`), request/response schemas derived from `@kotori/db`, public errors
packages/language   → Japanese/English text utilities (rōmaji ↔ kana, deinflection, furigana, phrase normalization)
packages/srs        → Pure Anki SM-2 (v3) spaced-repetition scheduler
packages/ai         → Claude, Jev, and ElevenLabs integrations + golden evaluations
apps/backend        → HTTP API, enrichment worker, and `kotori` CLI (`src/entrypoints/{http,worker,cli}.ts`)
apps/app            → Expo Router app for iOS, Android, and web
tools/local-auth    → Local stand-in for Neon Managed Better Auth (:4001)
```

- **Schema-first flow**: Queries in `@kotori/backend` and wire schemas in `@kotori/contracts` derive from `@kotori/db` tables, and `@kotori/app` is typed by `@kotori/contracts`. After changing `packages/db/src`, generate migrations with `pnpm --filter @kotori/db generate` (verified in CI by `pnpm nx run @kotori/db:check`).
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
- **Pull requests**: Squash-merged into `main` with Conventional Commit titles (`feat(app): ...`, `fix: ...`) and `Closes #<issue>` when resolving an issue. Commit PR screenshots to the shared orphan `assets` branch under `<slug>/<file>`.

## Coding standards

Coding standards live in `CODING_STANDARDS.md`. Read it before writing or reviewing code.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `0Calories/kotori`, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
