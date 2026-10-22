# Production readiness: backend tooling and infra plan

Status: phases 1 to 3 implemented 2026-10-21, phase 4 on 2026-10-22; phases 5 and 6 pending (see §4 for the Postgres decision).

- [x] Phase 1: toolchain baseline (Node 24, TypeScript 7 + 6, Nx 23.3, pnpm catalog)
- [x] Phase 2: TypeScript project references (Nx TS solution setup)
- [x] Phase 3: lint and format (Oxlint, Oxfmt)
- [x] Phase 4: production entry points + Postgres port of packages/db (§4)
- [ ] Phase 5: Railway (api + worker services, Postgres plugin)
- [ ] Phase 6: GitHub Actions CI
- [ ] Follow-up: Nx 24 migration once past the release-age window (after 2026-10-22) Milestone: invite-only private beta. Scope: backend architecture and infra only; the Expo app is touched only where the workspace changes force it.

## 1. Decisions already made

- **pnpm + Node** stay. Bun is revisited post-beta only if install or startup time becomes a measured problem.
- **Railway with Railpack**, no Dockerfile. Reproducible local images are deferred until there is a reason to leave Railway or control the build.
- **Compile with `tsc`** (TypeScript 7, project references, `tsc --build`), not a bundler. The deployable is the emitted `dist/` of each app plus the emitted `dist/` of the packages it references.
- **Oxlint + Oxfmt** for lint and format. No ESLint, no Prettier.
- **pnpm catalogs** for a single-version policy.
- Deferred: observability beyond structured logs, staging environments, release versioning / changesets, Dockerfile.

## 2. Findings that shape the plan

Verified while scoping; each one changes a step below.

1. **TypeScript 7.0.2 is GA but has no programmatic compiler API** (`require("typescript")` exports only the version). Nx, which reads tsconfigs through that API, needs TypeScript 6 installed alongside 7 until Nx picks up the 7.1 API. Nx documents the setup: alias `typescript` to `@typescript/typescript6` and `@typescript/native` to `typescript@7`, so `tsc` is 7 and `tsc6` is 6. Nx's own supported range is `>= 5.8 < 7.1`.
2. **Project references and `--build` work in 7.0.2 with this codebase's conventions.** Probed in a scratch workspace: `module: preserve` + `moduleResolution: bundler` + `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` + `customConditions` + `composite` emit correct `./b.js` imports and resolve a workspace dependency through its `exports` map. `--builders N` parallelises reference builds.
3. **Railway attaches one volume to exactly one service, and a volume cannot be shared.** `kotori.db`, `auth.db` and `data/audio` are files, so the API and the worker cannot be two Railway services. Either the worker loop runs inside the API process, or the database moves to Postgres. Recommendation in §4.
4. **There is no health endpoint and no production entry.** `start` runs `tsx src/main.ts`; nothing emits JavaScript; Railway has nothing to health-check. `BETTER_AUTH_SECRET` falls back to a development secret with a warning instead of refusing to start.
5. **Node 22 is in maintenance** (since 2025-10-21). Node 24 is LTS until 2028-04 and entered maintenance on 2026-10-20; Node 26 becomes Active LTS on 2026-10-28. Railpack resolves `engines.node: ">=22.12"` loosely; the version should be pinned.
6. **Nx 24.0.0 shipped** (23.3.0 installed). Relevant changes: `@nx/js/typescript` is the only typecheck provider, affected tasks are selected by default, `nx format` detects Oxfmt from `.oxfmtrc.json`, `@nx/oxlint` plugin (experimental) infers `lint`.
7. **Small drift to clean up on the way:** README says pnpm 11 (package.json pins 12.14); `apps/app` carries its own `typescript` devDependency; `effect` / `@effect/*` / `vitest` versions are repeated across 11 package.jsons; no `.node-version`; no `.github/`.

## 3. Target shape

Updated 2026-10-22 for the decision in §4.

```
Railway project "kotori"
├── Postgres (plugin)           DATABASE_URL, referenced by both services; holds Better Auth's tables and audio clips too
├── service "api"               Railpack, from repo root (no Root Directory)
│   ├── build   pnpm nx run-many -t build -p @kotori/api
│   ├── start   node apps/api/dist/main.js
│   └── health  GET /health
└── service "worker"            Railpack, from repo root
    ├── build   pnpm nx run-many -t build -p @kotori/worker
    ├── start   node apps/worker/dist/main.js work
    └── admin   railway ssh -- node apps/worker/dist/main.js approve <email>
```

Locally, `docker compose up -d` provides Postgres; `pnpm dev` runs the API and the worker from source with `tsx`; tests run from source with Vitest on PGlite, needing nothing installed. Compilation is for CI and deploys.

## 4. Decision: Postgres, separate API and worker services

Decided 2026-10-21. The API and the worker stay separate processes and become separate Railway services. The worker has significant planned changes and will need to scale on its own, so an enrichment loop embedded in the API process was rejected as a short-term hack. The SQLite-on-one-volume constraint is therefore resolved by moving to **Postgres** (Railway managed), which also removes the deploy-overlap and single-writer caveats below.

Consequences for later phases:

- Phase 4 gains the `packages/db` port: Postgres client (`@effect/sql-pg`), migrations, full-text search replacing FTS5, the Better Auth adapter, and a re-seed of JMDict. Audio files move off the local disk too (object storage, or Postgres bytea at beta volume), since the volume that held them would otherwise tie `data/audio` to one service.
- Phase 5 becomes two services (`api`, `worker`) plus a Postgres plugin, with no volume, default deploy overlap, and `railway.json` per app.
- The rejected alternative, for the record: fork the worker loop inside the API behind a flag. Cheaper by days, but it couples the two deployables exactly where they are expected to diverge.

Phases 1 to 3 are unaffected by this decision.

## 5. Phases

Each phase is one PR, green on CI before the next. Order matters: 1 before 2 (Nx 24 and the TS 6/7 aliases are prerequisites for the TS solution setup), 2 before 4 and 5 (deploys need `dist/`), 6 is last so every earlier phase is exercised by the real workflow.

### Phase 1: toolchain baseline

Done 2026-10-21. Deviation: **Nx stays on 23.3.0**. Nx 24.0.0 was published the same day and pnpm's default 24-hour `minimumReleaseAge` refuses it; everything phase 2 needs (`@nx/js/typescript`, `nx sync`) is in 23.3. Run `pnpm nx migrate latest` after 2026-10-22.

- **Node 24.** `.node-version` = current 24.x; `engines.node: ">=24"`; `@types/node` → `^24`. Railpack reads `.node-version`. (Node 26 LTS lands next week; moving later is a one-line change.)
- **Nx 24.** `pnpm nx migrate latest`, run migrations, add `@nx/js` (needed for the typescript plugin) and `@nx/oxlint`.
- **TypeScript 7 + 6 side by side**, exactly the Nx-documented aliases:
  ```json
  "@typescript/native": "npm:typescript@^7.0.2",
  "typescript": "npm:@typescript/typescript6@^6.0.2"
  ```
  Remove the `typescript` devDependency from `apps/app` (Expo's `tsc --noEmit` resolves the root one). Confirm `pnpm tsc --version` is 7 and `pnpm tsc6 --version` is 6.
- **pnpm catalogs.** `catalog:` in `pnpm-workspace.yaml` for `effect`, `@effect/*`, `vitest`, `@effect/vitest`, `typescript`, `@types/node`, `better-auth` / `@better-auth/*`, `expo` family; every package.json references `catalog:`. Enable `catalogMode: strict` so a non-catalog spec for a catalogued package fails install. Keep `minimumReleaseAge`; the exclusion list shrinks as those versions age out.
- Fix README (pnpm 12, Node 24).

### Phase 2: TypeScript project references (Nx TS solution setup)

Done 2026-10-21. Deviations from the sketch below: the source condition is **`@kotori/source`**, not `development`, because Metro would otherwise resolve third-party packages to their development builds in a production export; Vitest opts in through a one-line `vitest.config.ts` per project re-exporting `vitest.shared.ts`; `tsconfig.spec.json` emits declarations only with import rewriting off, since tests are type-checked, never run from emitted JS, and relative `../src/*.ts` imports would otherwise trip TS2878.

Layout, per Nx's convention so `nx sync` can maintain it:

- `tsconfig.base.json`: add `composite: true`, `declaration: true`, `declarationMap: true`, `sourceMap: true`, `rewriteRelativeImportExtensions: true`, `customConditions: ["development"]`. Keep every existing strictness flag. `noEmit` and `types: []` move out of base (emit is per project; `types` is set per project).
- Root `tsconfig.json`: `{ "files": [], "references": [ ...every project ] }`, owned by `nx sync`.
- Per project (`apps/api`, `apps/worker`, every package):
  - `tsconfig.json`: `files: []`, references to `tsconfig.lib.json` and `tsconfig.spec.json`.
  - `tsconfig.lib.json`: `include: ["src"]`, `outDir: "dist"`, `rootDir: "src"`, `tsBuildInfoFile: "dist/tsconfig.lib.tsbuildinfo"`, `types: ["node"]` where needed, `references` to the `tsconfig.lib.json` of each `@kotori/*` dependency (generated from package.json by `nx sync`).
  - `tsconfig.spec.json`: `include: ["test"]`, `noEmit: true`, references the project's own `tsconfig.lib.json`.
  - `apps/app` keeps its Expo tsconfig and stays out of the reference graph (Metro compiles it); it still typechecks on its own.
- `package.json` `exports` for every package:
  ```json
  ".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  ```
  Node (production) takes `default`; `tsc` takes `development` while building thanks to `customConditions`, so references resolve to source and declarations are emitted per project; tools that run from source opt in to `development`:
  - `tsx` dev scripts get `-C development` (verified: tsx forwards `--conditions`).
  - Vitest: Vite's default conditions already include `development` when `NODE_ENV` is not `production`; confirm with a run, otherwise set `resolve.conditions` in a root `vitest.config.ts` (also a good place for `@effect/vitest` setup shared by all packages).
  - Metro: add `development` to `resolver.unstable_conditionNames` in `apps/app/metro.config.js` so the app keeps importing `@kotori/domain` and `@kotori/srs` from source. Verify on web and iOS.
- `nx.json`: register `@nx/js/typescript` with `typecheck` (default `tsconfig.json`) and `build: { configName: "tsconfig.lib.json" }`; `compiler` stays `tsc`, which is TypeScript 7 through the alias. Delete the hand-written `typecheck` scripts; `build` for api/worker becomes `tsc --build` through the plugin. `targetDefaults.build.outputs` already points at `{projectRoot}/dist`.
- `apps/worker` `bin` points at `dist/main.js`; `start` scripts become `node dist/main.js`.
- CI runs `nx sync:check` so stale references fail the build instead of silently resolving through `node_modules`.

Side effect worth having: a project can only import what its references list, and references come from declared dependencies. An undeclared `@kotori/*` import now fails typecheck (TS6307). That is the module-boundary enforcement for now; ESLint-style tag rules are deferred.

### Phase 3: lint and format

Done 2026-10-21. Deviations: lint and format are root scripts (`pnpm lint`, `pnpm format:check`) rather than `@nx/oxlint`, which depends on `@nx/eslint-plugin` and typescript-eslint; a whole-repo Oxlint run takes well under a second, so per-project caching buys nothing. Style-only rules that fight Effect idioms (`_tag`, shadowing in pipelines) are off. React findings in `apps/app` are warnings until the app gets its own cleanup pass. The first format commit touched 122 files: Oxfmt is Prettier-compatible and expands nested calls that dprint kept on one line.

- `oxlint` + `.oxlintrc.json` at the root: `correctness` and `suspicious` as errors, `typescript` and `unicorn` plugins on, `import` plugin for cycle detection. Type-aware rules are off (they would need the TS 6 API path; revisit on 7.1).
- `oxfmt` + `.oxfmtrc.json` matching the existing style so the first format commit is small: `semi: false`, `singleQuote: false`, `printWidth: 120`, `trailingComma: "none"`, `sortImports` on (the code is already sorted that way). Oxfmt is still pre-1.0 (0.74); pin exact and bump deliberately.
- `@nx/oxlint` plugin infers `lint` per project; `nx format:check` picks Oxfmt up from the config file. Root scripts: `lint`, `format`, `format:check`.
- `.vscode/settings.json` and `extensions.json` recommending `oxc.oxc-vscode` with format on save.

### Phase 4: production entry points and the Postgres port

Done 2026-10-22. Verified with the whole suite on PGlite and again on Postgres 17 in Docker (`KOTORI_TEST_DATABASE_URL`), plus a smoke run of the built API in production mode and a full JMDict import through the built worker.

**Postgres port of `packages/db`**

- `@effect/sql-pg` (Effect's own wire-protocol client, no `pg`/`postgres` dependency) over `DATABASE_URL`, which is always required. Migrations run through `effect/sql/Migrator` at startup, under its lock, so the API and the worker can start together.
- One migration, `0001_initial`, instead of replaying the SQLite history: there were no learners yet, so the SQLite files and the audio generated for them are not migrated. Re-seed JMDict after the first deploy (`DATABASE_URL=<Railway public URL> pnpm kotori seed` from a laptop, or `railway ssh`); the full import took 23 s against a local Postgres 17 and leaves a 253 MB database, indexes included.
- Times stay millisecond numbers, stored as `bigint`. Effect's client decodes `bigint` as `BigInt`, so `@kotori/db` registers a codec that reads int8 as a number (and refuses anything past 2^53); PGlite already returns numbers.
- JMDict's lists, nuance, raw Jev answers and note content are `jsonb`, written as JSON strings (the client binds strings untyped, so Postgres casts) and read back as values; `Schema.fromJsonString` is gone from the row schemas. `transformJson` is off so keys inside stored JSON are never renamed.
- Booleans are `boolean`, identities are `GENERATED ALWAYS AS IDENTITY`, `INSERT OR IGNORE` became `ON CONFLICT DO NOTHING`, `max()` on booleans became `bool_or()`, `sum(cond)` became `count(*) FILTER (WHERE …)`. `interval` and `position` are quoted where they appear bare.
- **Search**: FTS5 is replaced by a `tsvector` generated column on `glosses` (`to_tsvector('english', text)`) with a GIN index. Queries go through `websearch_to_tsquery`, which ANDs the words and never errors on user input, ranked by `ts_rank_cd` (higher is better; the API's scoring was adjusted). `rebuildSearchIndex` is gone: the column is always current. Japanese prefix search uses `COLLATE "C"` on `forms.text` so the range trick is an index scan.
- **Jobs**: `claim` adds `FOR UPDATE SKIP LOCKED`, so several worker replicas can share the queue.
- **Tests**: `DatabaseMemory` moved to `@kotori/db/testing` and runs PGlite (Postgres compiled to WebAssembly, `@effect/sql-pglite`, a devDependency) in memory. PGlite ships Postgres 18 while Railway runs 17; everything the schema uses exists since Postgres 12. Setting `KOTORI_TEST_DATABASE_URL` runs the same suites against a server, wiping its `public` schema first (`vitest --no-file-parallelism`).

**Better Auth** stays in the same database: its `user`, `session`, `account` and `verification` tables sit next to Kotori's, still created and migrated by Better Auth. Rather than a second driver and pool, `packages/auth/src/SqlClientDialect.ts` is a small Kysely dialect that executes Better Auth's compiled Postgres SQL on Effect's `SqlClient` (reserving a connection per query or transaction). One `DATABASE_URL`, one pool, and the auth tests run on PGlite like the rest. Better Auth's migration is retried a few times so two processes starting at once don't trip over each other's `CREATE TABLE`. `KOTORI_AUTH_DB_PATH` is gone.

**Audio** moved off the disk into Postgres: `audio_clips (key, data bytea)`, written through `EnrichmentRepo` and served by the same `AudioStore` interface (`packages/tts`). At beta volume (50k TTS characters a month) this is a few megabytes a month and needs no bucket or credentials; the interface is where object storage would plug in later. `KOTORI_AUDIO_DIR` is gone.

**Entry points**

- **`GET /health`** already existed as the `system` group of the HttpApi: unauthenticated, reports configured features and counts dictionary entries, so a 200 means the database is reachable. No second route was added. The server listens only after migrations and Better Auth's tables are in place.
- **Fail fast**: with `NODE_ENV=production`, missing `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` is a `ConfigError` at startup; elsewhere the development secret and `http://localhost:<port>` stand in, with a warning.
- **Structured logs**: `LoggerLive` (JSON lines in production, pretty console otherwise) wraps both `main.ts` files. Better Auth's own warnings still go through its logger in its format; routing them into Effect's is a follow-up.
- **Shutdown**: unchanged, `NodeRuntime.runMain` handles SIGTERM and runs finalizers (pool, server).
- **`@kotori/runtime`** is new and small: `workspaceRoot`, `resolveFromRoot`, `loadDotEnv` (moved out of `@kotori/db`, which no longer deals in paths), `isProduction` and `LoggerLive`. The API, the worker, `@kotori/auth` and `@kotori/jmdict` use it.
- **Not done, by decision**: the embedded worker (`KOTORI_WORKER=inline`) from the earlier sketch, see §4. The worker is its own Railway service in phase 5.

**Local development**: `docker-compose.yml` runs Postgres 17 with the credentials in `.env.example`; `pnpm seed` and `pnpm dev` work as before once it is up.

### Phase 5: Railway (to be rewritten for two services + Postgres, see §4)

- `apps/api/railway.json` (Railway's config-file setting on the service points at this path; config overrides the dashboard):
  ```json
  {
    "$schema": "https://railway.com/railway.schema.json",
    "build": {
      "builder": "RAILPACK",
      "buildCommand": "pnpm nx run-many -t build -p @kotori/api @kotori/worker",
      "watchPatterns": ["/apps/api/**", "/apps/worker/**", "/packages/**", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/package.json", "/tsconfig.base.json", "/apps/api/railway.json"]
    },
    "deploy": {
      "startCommand": "node apps/api/dist/main.js",
      "healthcheckPath": "/health",
      "healthcheckTimeout": 120,
      "restartPolicyType": "ON_FAILURE",
      "restartPolicyMaxRetries": 5,
      "overlapSeconds": 0,
      "drainingSeconds": 30
    }
  }
  ```
  `overlapSeconds: 0` is deliberate: the default overlap runs old and new containers together, which means two writers on one SQLite file. Brief downtime per deploy is the right trade at beta.
- Service settings (dashboard, not expressible in the file): no Root Directory; volume mounted at `/data`; **Wait for CI** on, so a push to `main` deploys only after the GitHub workflow succeeds.
- Environment (after phase 4): both services get `NODE_ENV=production` and `DATABASE_URL=${{Postgres.DATABASE_URL}}`; the API also `KOTORI_PORT=${{PORT}}`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `KOTORI_WEB_ORIGIN`, `RESEND_API_KEY`; the worker the provider keys `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `ELEVENLABS_API_KEY` (the API needs them too for the coach and on-demand audio). The worker still needs the Better Auth settings because its CLI shares `Auth` for approvals. Document in `.env.example` and a short `docs/deploy.md` (first seed: `railway ssh -- node apps/worker/dist/main.js seed`).
- Railpack picks Node from `.node-version` and pnpm from `packageManager`; set `RAILPACK_PRUNE_DEPS=true` once the build is confirmed to need nothing from devDependencies at runtime (it should not: `tsx` and `typescript` are build-time only).

### Phase 6: GitHub Actions

`.github/workflows/ci.yml`, on `pull_request` and `push` to `main`:

1. `actions/checkout@v7` with `fetch-depth: 0` (affected needs history), `pnpm/action-setup@v6` (reads `packageManager`), `actions/setup-node@v7` with `node-version-file: .node-version` and `cache: pnpm`.
2. `pnpm install --frozen-lockfile`.
3. `nrwl/nx-set-shas@v5`, then `pnpm nx sync:check`, `pnpm nx format:check`, `pnpm nx affected -t lint typecheck test build`.
4. Nx cache: `.nx/cache` keyed on the lockfile via `actions/cache@v6`. Nx Cloud is not needed at this size.
5. Concurrency: cancel in-progress runs for pull requests only. Runs on `main` must not be cancelled, because Railway's Wait for CI treats a cancelled run as a failure when nothing else on the commit passed.

No deploy job: Railway's GitHub integration deploys `main` after this workflow is green. That keeps deploy credentials out of GitHub entirely.

Optional, same PR: Renovate (`renovate.json`, pnpm catalog aware, grouped `effect`, `expo`, `better-auth` updates, weekly) so the single-version policy is maintained by a bot instead of by hand.

## 6. Out of scope, noted for later

- Dockerfile when build reproducibility or portability is needed.
- Tag-based module boundaries once Oxlint can run the Nx rule, or if TS reference errors prove too blunt.
- Type-aware lint rules on TypeScript 7.1.
- Staging environment and Railway PR environments (the `pr` block in `railway.json` makes this cheap when wanted).
