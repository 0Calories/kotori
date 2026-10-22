# Deploying Kotori to Railway

One Railway project, two services built from this repo plus a managed Postgres. Service config lives in `apps/api/railway.json` and `apps/worker/railway.json` (config-as-code overrides the dashboard); this page covers the parts that only exist in the dashboard, the environment, and day-two operations.

```
Railway project "kotori"
├── Postgres                   DATABASE_URL; Kotori's tables, Better Auth's tables, audio bytes
├── api      (from GitHub)     node apps/api/dist/main.js        health: GET /health
└── worker   (from GitHub)     node apps/worker/dist/main.js work
```

Nothing is written to disk: the dictionary, learner data, sessions and MP3 clips all live in Postgres, so there are no volumes and both services can redeploy with overlap.

## 1. One-time setup

1. **Postgres**: add the Postgres plugin to the project. It exposes `DATABASE_URL` (and `DATABASE_PUBLIC_URL` for access from outside Railway).
2. **Services**: create two services from the GitHub repo, branch `main`. For each:
   - *Settings → Build → Config-as-code*: `apps/api/railway.json` or `apps/worker/railway.json`.
   - *Root Directory*: leave empty. The whole repo is deployed; Nx builds only the service's project and the packages it depends on, and `watchPatterns` in the config file stop a service redeploying for changes outside its graph.
   - *Settings → Deploy → Wait for CI*: on, once phase 6's workflow exists. Railway then deploys a push to `main` only after the GitHub checks pass.
   - *Networking* (api only): generate a public domain, or attach `api.<your domain>`.
3. **Variables**: see §2. Use a shared-variable group for everything both services read.
4. **First deploy**, then **seed** the dictionary (§3). Until seeded, `/health` reports `dictionary.entries: 0` and search returns nothing.
5. **First admin**: sign up in the app, then from the worker service `railway ssh -- node apps/worker/dist/main.js admin you@example.com`.

Railpack picks Node from `.node-version` and pnpm from `packageManager` in `package.json`, runs `pnpm install --frozen-lockfile`, then the `buildCommand` from the config file. Set `RAILPACK_PRUNE_DEPS=true` on both services: devDependencies (TypeScript, Nx, Vitest, PGlite, tsx) are build-time only and are dropped from the image after the build. Verified by building, pruning and booting both services from a clean Node 24 container.

## 2. Environment

| Variable | api | worker | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | same | Shared by Kotori's repositories and Better Auth. |
| `NODE_ENV` | `production` | `production` | JSON logs; makes `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` mandatory (startup fails without them). |
| `PORT` | injected by Railway | – | The API listens on `KOTORI_PORT`, then `PORT`, then 4000. No mapping needed. |
| `BETTER_AUTH_SECRET` | required | required (CLI loads Better Auth) | `openssl rand -base64 32`. Same value on both services. |
| `BETTER_AUTH_URL` | required | required | Public origin of the API, e.g. `https://api.kotori.app`. Used in emailed links and cookie settings. |
| `KOTORI_WEB_ORIGIN` | optional | – | Origin of the deployed web app, allowed for cookies/CORS. |
| `RESEND_API_KEY`, `KOTORI_EMAIL_FROM` | optional | optional | Verification, reset and approval emails. Without a key, emails are logged instead. The worker sends approval emails. |
| `ANTHROPIC_API_KEY` | optional | optional | Coach features (api), example sentences (worker). |
| `TYPESAFE_API_KEY` | optional | optional | Nuance via Jev. |
| `ELEVENLABS_API_KEY` | optional | optional | Pronunciation audio; `KOTORI_AUDIO_MONTHLY_CHARS` caps spend. |
| `RAILPACK_PRUNE_DEPS` | `true` | `true` | Build-time only. |

Every optional provider degrades gracefully: `/health` reports which features are on, and the API queues enrichment only for configured providers. `.env.example` documents the full list with defaults.

## 3. Seeding and re-seeding the dictionary

JMDict (~200k entries, ~10 MB download) is imported by the worker's `seed` command. Run it inside the worker service so the import talks to Postgres over the private network:

```sh
railway ssh --service worker -- node apps/worker/dist/main.js seed
```

Re-running `seed` upserts entries, so a JMDict refresh is the same command. Enrichment (nuance, examples, audio) survives a re-seed; it is keyed by entry id.

Alternative from a laptop, over the public proxy (slower, fine for `--common-only`), using `DATABASE_PUBLIC_URL` from the Postgres service's *Variables* tab:

```sh
DATABASE_URL="postgres://…proxy.rlwy.net:…/railway" pnpm seed -- --common-only
```

## 4. Day two

- **Sign-ups**: `railway ssh --service worker -- node apps/worker/dist/main.js requests|approve|archive|users|admin|revoke …` — the same `kotori` CLI as locally (`pnpm kotori …`), against production.
- **Enrichment coverage and queue**: `… node apps/worker/dist/main.js status`. Backfill in bulk with `… enrich --help`.
- **Logs**: JSON lines in each service's log view; the API logs one line per request with method, path, status and the request span's duration.
- **Deploys**: pushes to `main` build both services (`watchPatterns` skip the ones not affected). The API deploys with Railway's default overlap (old and new containers serve together, then the old drains for 30 s); the worker uses `overlapSeconds: 0` so two workers never process the same queue during a deploy, and drains for 60 s to let an in-flight enrichment finish. Jobs left `running` by a killed worker are requeued on the next start (`requeueStale`).
- **Schema changes**: Kotori's migrations run on API and worker startup (`effect_sql_migrations` tracks them); Better Auth migrates its own tables on startup too. Both are idempotent, so two services starting together is fine.
- **Rollback**: redeploy a previous deployment from the Railway UI. Migrations are forward-only; write a new migration rather than editing an applied one.
- **Backups**: Railway's Postgres plugin takes daily backups; the dictionary and enrichment are rebuildable, learner data is not.

## 5. Not set up (yet)

- Staging environment / PR environments (`environments` in `railway.json` makes this cheap when wanted).
- Observability beyond structured logs.
- Dockerfile; Railpack is the builder until reproducibility outside Railway matters.
