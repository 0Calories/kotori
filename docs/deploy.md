# Deploying Kotori: Fly.io + Neon

Compute on [Fly.io](https://fly.io), Postgres on [Neon](https://neon.tech). One Fly app runs two process groups from one Docker image; Neon holds everything stateful (Kotori's tables, Better Auth's tables, audio bytes). The two providers are deliberately independent: a compromise of one does not hand over the other, and either can be swapped without touching application code.

```
Neon project "kotori"            Postgres 17, region matching Fly's primary region
└── DATABASE_URL (direct, sslmode=verify-full)
            ▲
Fly app "kotori"                 Dockerfile at the repo root, config in fly.toml
├── process group "api"          node apps/api/dist/main.js      HTTPS :443 → :8080, health GET /health
└── process group "worker"       node apps/worker/dist/main.js work
```

Nothing is written to disk, so there are no volumes and any machine can be replaced at any time. The image is about 300 MB compressed (see the plan's phase 5 notes for why, and what would shrink it).

## 1. One-time setup

### Neon

1. Create a project in the region closest to Fly's `primary_region` (`iad` ↔ AWS `us-east-1`). Postgres 17.
2. Create a dedicated role (e.g. `kotori`) and database rather than using the project owner. Better Auth creates its own tables on first start, so the role needs DDL on that database; it gets it as the database owner.
3. Copy the **direct** (unpooled) connection string and append `?sslmode=verify-full`. Both drivers (Effect's `@effect/sql-pg` for Kotori, `pg` for Better Auth) then verify Neon's certificate against the system CA store. The pooled string is not needed: two small machines hold a handful of connections each.
4. Compute: the smallest size is fine for the beta. Neon suspends idle compute (first query after a pause takes about half a second); on a paid plan you can disable autosuspend for the API's sake. Set the history retention you want for point-in-time recovery.

### Fly

```sh
fly auth login
fly launch --no-deploy          # adopts fly.toml; pick the org, confirm the region, rename the app if "kotori" is taken
fly secrets set \
  DATABASE_URL='postgres://kotori:…@ep-….aws.neon.tech/kotori?sslmode=verify-full' \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BETTER_AUTH_URL='https://kotori.fly.dev' \
  RESEND_API_KEY=… ANTHROPIC_API_KEY=… TYPESAFE_API_KEY=… ELEVENLABS_API_KEY=…
fly deploy                      # builds the Dockerfile on Fly's remote builder, rolls out both process groups
fly scale count api=1 worker=1  # one machine each; see "Availability" below before raising api
```

Secrets are encrypted at rest, injected into machines at boot, and never displayed again after being set (`fly secrets list` shows digests). `fly secrets set --stage` queues a change for the next deploy instead of restarting now.

Custom domain: `fly certs add api.kotori.app`, point a CNAME at `kotori.fly.dev`, then update `BETTER_AUTH_URL` and the app's API base URL.

### First data

Neon is reachable from anywhere over TLS, so seeding from a laptop is the simplest path and takes the same route the machines use:

```sh
DATABASE_URL='postgres://…neon.tech/kotori?sslmode=verify-full' pnpm seed            # full JMDict, ~200k entries
DATABASE_URL='…' pnpm seed -- --common-only                                           # ~22k common entries, faster
```

Or from inside the worker machine: `fly ssh console --process-group worker -C "node apps/worker/dist/main.js seed"` (the download lands on the machine's ephemeral disk, which is fine for a one-off).

First admin: sign up in the app, then `fly ssh console --process-group worker -C "node apps/worker/dist/main.js admin you@example.com"`.

## 2. Environment

Set with `fly secrets set` unless marked plain (plain values live in `[env]` of `fly.toml`). Both process groups share the same secrets.

| Variable | Needed by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | api, worker | Neon direct string with `sslmode=verify-full`. Shared by Kotori's repositories and Better Auth. |
| `NODE_ENV` | api, worker | `production`, plain in `fly.toml`. JSON logs; makes `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` mandatory (startup fails without them). |
| `PORT` | api | `8080`, plain in `fly.toml`. The API reads `KOTORI_PORT`, then `PORT`, then 4000. |
| `BETTER_AUTH_SECRET` | api, worker | `openssl rand -base64 32`. The worker's account commands load Better Auth too. |
| `BETTER_AUTH_URL` | api, worker | Public origin of the API. Used in emailed links and cookie settings. |
| `KOTORI_WEB_ORIGIN` | api | Optional. Origin of the deployed web app, allowed for cookies/CORS. |
| `RESEND_API_KEY`, `KOTORI_EMAIL_FROM` | api, worker | Optional. Without a key, emails are logged instead. The worker sends approval emails. |
| `ANTHROPIC_API_KEY` | api, worker | Optional. Coach features (api), example sentences (worker). |
| `TYPESAFE_API_KEY` | worker | Optional. Nuance via Jev. |
| `ELEVENLABS_API_KEY` | api, worker | Optional. Pronunciation audio; `KOTORI_AUDIO_MONTHLY_CHARS` caps spend. |

Every optional provider degrades gracefully: `/health` reports which features are on, and the API queues enrichment only for configured providers. `.env.example` has the full list with defaults.

### Keeping the keys worth less

The platform's secret store is one layer; assume it can fail. Use **separate API keys for production** at Anthropic, ElevenLabs, TypeSafe and Resend, each with a **hard spend cap** at the provider, so a leaked key is bounded and revocable without touching development. Rotate by `fly secrets set` plus a deploy. If you want keys to never sit in any hosting dashboard, a secrets manager (Doppler, Infisical, 1Password) can inject them at deploy time; the app only reads environment variables, so nothing changes in code.

## 3. Day two

- **Sign-ups**: `fly ssh console --process-group worker -C "node apps/worker/dist/main.js requests|approve|archive|users|admin|revoke …"` — the same `kotori` CLI as locally (`pnpm kotori …`), against production. Or run it from a laptop with `DATABASE_URL` set; Neon doesn't care where the client is.
- **Enrichment coverage and queue**: `… status`. Backfill in bulk with `… enrich --help`.
- **Logs**: `fly logs` (add `--process-group api`); JSON lines, one per request with method, path, status and span duration. Metrics and a Grafana dashboard come with the app.
- **Deploys**: `fly deploy` (phase 6 moves this into GitHub Actions with a deploy token). Strategy is rolling. With one machine per group, the worker stops before its replacement starts, so two workers never process the queue at once during a deploy; `kill_timeout = 60` gives an in-flight enrichment a minute to finish, and jobs left `running` by a killed worker are requeued on the next start (`requeueStale`). The API is briefly unavailable during a one-machine deploy.
- **Availability**: `fly scale count api=2` keeps one API machine serving while the other updates and survives a single-machine failure, for about the price of a coffee. Fly's health check restarts a machine whose `/health` fails. Neon's compute is managed and restored from storage on failure; history retention gives point-in-time recovery.
- **Schema changes**: Kotori's migrations run on API and worker startup (`effect_sql_migrations` tracks them); Better Auth migrates its own tables on startup too. Both are idempotent, so the two groups starting together is fine. Migrations are forward-only; write a new one rather than editing an applied one.
- **Rollback**: `fly releases` then `fly deploy --image <previous image>`; or restore the database to a point in time in Neon (or branch from one to inspect first).
- **Backups**: Neon's history retention is the backup; the dictionary and enrichment are rebuildable, learner data is not. Consider a periodic `pg_dump` to object storage once there are real learners.

## 4. Follow-ups

- **Neon Auth (managed Better Auth)** could replace the self-hosted Better Auth. Before switching, confirm it supports what `packages/auth` relies on: the `admin` and `expo` plugins, the `status` and `locale` additional user fields, custom email delivery through Resend (verification, reset, approval templates), the `user.delete.after` hook that removes the learner profile, and the internal-adapter calls the approval CLI uses (list and update users, revoke sessions). Until then Better Auth runs in the API against Neon exactly as it did against the local database.
- Staging: a Neon branch plus a second Fly app (`fly launch` with another name) is cheap when wanted; `fly.toml` needs no changes.
- Observability beyond structured logs.
