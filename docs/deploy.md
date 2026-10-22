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

Tooling is already in the repo: the Neon CLI (`npm i -g neon`), `neon.ts` at the root (declares `auth: true` — Managed Better Auth — plus a cheap scale-to-zero policy for new dev branches), and `@neon/config`. The steps that need a human account:

1. `neon login`, then from the repo root either create and link a project in the region closest to Fly's `primary_region` (`iad` ↔ `aws-us-east-1`):

   ```sh
   neon link --org-id <org-id> --project-name kotori --region-id aws-us-east-1
   ```

   or link an existing one (`neon link --project-id <id> -y`). Linking writes the git-ignored `.neon` and by default pulls the branch's env into `.env` — pass `--no-env-pull` to keep developing against local Docker Postgres instead of a Neon branch.
2. `neon deploy` — applies `neon.ts` to the linked branch: provisions Managed Better Auth and pulls `NEON_AUTH_BASE_URL` (and `DATABASE_URL`) into the local env file. `neon neon-auth status` to confirm. Postgres 17; the smallest compute is fine for the beta — Neon suspends idle compute (first query after a pause takes about half a second); disable autosuspend for production once it matters, and set history retention for point-in-time recovery.
3. Create a dedicated role (e.g. `kotori`) owning the application database rather than using the project owner. Kotori's migrator needs DDL; Managed Better Auth keeps its own `neon_auth` schema on the branch.
4. For Fly, use the **direct** (unpooled) connection string with `?sslmode=verify-full`. Both drivers (Effect's `@effect/sql-pg` for Kotori, and `pg` while self-hosted Better Auth remains) verify Neon's certificate against the system CA store. The pooled string is not needed: two small machines hold a handful of connections each.
5. Managed Auth production settings (console or `neon neon-auth …`): add trusted domains (`neon neon-auth domain add https://app.kotori.app`), disable localhost access, set the application name, and point the email webhooks at the API (§4) so Resend keeps sending Kotori's EN/JA templates.

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

## 4. Managed Better Auth (Neon Auth) migration

Decided 2026-10-22: migrate from self-hosted Better Auth to Neon's Managed Better Auth (`auth: true` in `neon.ts`). Checked against the live docs (plugins, webhooks, admin, customize-emails, production checklist) on 2026-10-22 — re-check before implementing. Self-hosted Better Auth keeps working against Neon until the cutover lands; `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` stay until then.

What `packages/auth` relies on, and where each lands:

| Today (self-hosted) | Managed |
| --- | --- |
| `admin` plugin | Supported. `authClient.admin.listUsers / setRole / updateUser` need an **admin session**, not a server secret — see the CLI note below. |
| `status`, `locale` additional user fields | Custom fields exist on the admin API (`data` on createUser/updateUser). Alternative worth taking anyway: move `status` into Kotori's own `users` profile table, so approval never writes to the auth system. |
| Verification/reset emails via Resend (EN/JA templates) | **Webhooks**: subscribing to `send.otp` / `send.magic_link` makes Managed Auth skip its own email and POST the code/link (EdDSA-signed) to our endpoint, which renders Kotori's templates and sends via Resend. Multi-language is explicitly supported this way. Note: flows move from links to codes/magic-links; plain verification *links* need custom SMTP instead. |
| Approval email (app-sent) | Unchanged — it never went through Better Auth. |
| `user.delete.after` hook → deletes learner profile | No `user.deleted` webhook (events: `user.before_create`, `user.created`, send.*, org, phone). Account deletion must go through a Kotori API endpoint that calls managed deletion and then removes the profile. `user.created` can JIT-create the profile if wanted. |
| Approvals CLI via `ctx.internalAdapter` | Reads: SQL against the `neon_auth` schema (identity lives in **our** database, queryable). Writes (approve/role/revoke): admin API with an admin session, or keep status in Kotori's table per above. |
| `expo` plugin | **Not in the managed plugin set, and there is no RN/Expo SDK guide.** The app has no auth UI yet (it stores a bearer token), so nothing breaks today. Plan: the app talks to the managed auth REST endpoints directly for sign-up/sign-in, then authenticates to the Kotori API with the managed **JWT plugin** (15-minute EdDSA tokens, verified against the injected `NEON_AUTH_JWKS_URL` — no auth-server round trip per request). Revocation lag of ≤15 min is acceptable at beta. Verify this end to end on a dev branch before building the app's auth screens. |
| `Auth.layerMemory` (tests on the memory adapter) | Tests of approval logic move to faking the thin client around managed endpoints; PGlite keeps covering Kotori's own tables. |

Cutover order (each step verifiable on a Neon dev branch before `main`): provision (`neon deploy`) → wire the API's Authorization middleware to JWKS verification → email webhooks → move approval status into Kotori's profile table + rewrite the CLI → app auth screens against the managed endpoints → remove `better-auth`, `@better-auth/expo` and `pg` from `packages/auth` (which also removes the React/Expo peer-dependency bloat from the deploy image). Per the production checklist: trusted domains, custom sender, app name, disable localhost.

## 5. Other follow-ups

- Staging: a Neon branch plus a second Fly app (`fly launch` with another name) is cheap when wanted; `fly.toml` needs no changes.
- Observability beyond structured logs.
