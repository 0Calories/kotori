# Deploying Kotori: Fly.io + Neon

Compute on [Fly.io](https://fly.io), Postgres on [Neon](https://neon.tech). One Fly app runs two process groups from one Docker image; Neon holds everything stateful (Kotori's tables, Better Auth's tables, audio bytes). The two providers are deliberately independent: a compromise of one does not hand over the other, and either can be swapped without touching application code.

```
Neon project "Kotori"            Postgres 18, aws-us-east-2 (Fly primary region ord)
└── DATABASE_URL (direct/unpooled string as pulled by the Neon CLI)
            ▲
Fly app "kotori"                 Dockerfile at the repo root, config in fly.toml
├── process group "api"          node apps/api/dist/main.js      HTTPS :443 → :8080, health GET /health
└── process group "worker"       node apps/worker/dist/main.js work
```

Nothing is written to disk, so there are no volumes and any machine can be replaced at any time.

## 1. One-time setup

### Neon

Tooling is already in the repo: the Neon CLI (`npm i -g neon`), `neon.ts` at the root (declares `auth: true` — Managed Better Auth — plus a cheap scale-to-zero policy for new dev branches), and `@neon/config`. The steps that need a human account:

1. `neon login`, then from the repo root either create and link a project in the region closest to Fly's `primary_region` (the project is in `aws-us-east-2`, so Fly runs in `ord`):

   ```sh
   neon link --org-id <org-id> --project-name kotori --region-id aws-us-east-1
   ```

   or link an existing one (`neon link --project-id <id> -y`). Linking writes the git-ignored `.neon` and by default pulls the branch's env into `.env` — pass `--no-env-pull` to keep developing against local Docker Postgres instead of a Neon branch.
2. `neon deploy` — applies `neon.ts` to the linked branch: provisions Managed Better Auth and pulls `NEON_AUTH_BASE_URL` (and `DATABASE_URL`) into the local env file. `neon neon-auth status` to confirm. Postgres 18; the smallest compute is fine for the beta — Neon suspends idle compute (first query after a pause takes about half a second); disable autosuspend for production once it matters, and set history retention for point-in-time recovery.
3. The project owner role is what Managed Auth grants access to `neon_auth` for; a dedicated role would need those grants replicated. Kotori's migrator needs DDL on the database. (Today everything runs as the owner; revisit before opening the beta.)
4. For Fly, use the **direct** (unpooled) connection string exactly as Neon hands it out (`neon env pull` writes it as `DATABASE_URL_UNPOOLED`; it already carries `sslmode=require&channel_binding=require`). The driver (Effect's `@effect/sql-pg`) treats `require` as full certificate verification against the system CA store, so there is nothing to append — appending a second `?sslmode=` breaks the URL. The pooled string is not needed: two small machines hold a handful of connections each.
5. Managed Auth production settings (console or `neon neon-auth …`): add trusted domains (`neon neon-auth domain add https://app.kotori.app`), disable localhost access, set the application name, and point the email webhooks at the API (§4) so Resend keeps sending Kotori's EN/JA templates.

### Fly

```sh
fly auth login
fly launch --no-deploy          # adopts fly.toml; pick the org, confirm the region, rename the app if "kotori" is taken
fly secrets set \
  DATABASE_URL='<DATABASE_URL_UNPOOLED of the production branch>' \
  NEON_AUTH_BASE_URL='<NEON_AUTH_BASE_URL of the production branch>' \
  RESEND_API_KEY=… ANTHROPIC_API_KEY=… TYPESAFE_API_KEY=… ELEVENLABS_API_KEY=…
fly deploy                      # builds the Dockerfile on Fly's remote builder, rolls out both process groups
fly scale count api=1 worker=1  # one machine each; see "Availability" below before raising api
```

Secrets are encrypted at rest, injected into machines at boot, and never displayed again after being set (`fly secrets list` shows digests). `fly secrets set --stage` queues a change for the next deploy instead of restarting now.

Custom domain: `fly certs add api.kotori.app`, point a CNAME at `kotori.fly.dev`, add it as a Neon Auth trusted domain, and update the app's API base URL.

### First data

Neon is reachable from anywhere over TLS, so seeding from a laptop is the simplest path and takes the same route the machines use:

```sh
DATABASE_URL='<DATABASE_URL_UNPOOLED>' pnpm seed            # full JMDict, ~200k entries (or just `pnpm seed` with .env.local pulled)
DATABASE_URL='…' pnpm seed -- --common-only                                           # ~22k common entries, faster
```

Or from inside the worker machine: `fly ssh console --process-group worker -C "node apps/worker/dist/main.js seed"` (the download lands on the machine's ephemeral disk, which is fine for a one-off).

First admin: sign up in the app, then `fly ssh console --process-group worker -C "node apps/worker/dist/main.js admin you@example.com"`.

## 2. Environment

Set with `fly secrets set` unless marked plain (plain values live in `[env]` of `fly.toml`). Both process groups share the same secrets.

| Variable | Needed by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | api, worker | Neon direct (unpooled) string as pulled. Kotori's tables and the `neon_auth` schema live here. |
| `NODE_ENV` | api, worker | `production`, plain in `fly.toml`. JSON logs. |
| `PORT` | api | `8080`, plain in `fly.toml`. The API reads `KOTORI_PORT`, then `PORT`, then 4000. |
| `NEON_AUTH_BASE_URL` | api, worker | The branch's Managed Auth URL (`neon env pull` writes it). The API proxies `/api/auth/*` to it; the worker's account commands never call it (they use SQL) but the layer requires it. |
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
- **Deploys**: every push to `main` that passes CI runs `flyctl deploy --remote-only` (§5); `fly deploy` from a laptop does the same. Strategy is rolling. With one machine per group, the worker stops before its replacement starts, so two workers never process the queue at once during a deploy; `kill_timeout = 60` gives an in-flight enrichment a minute to finish, and jobs left `running` by a killed worker are requeued on the next start (`requeueStale`). The API is briefly unavailable during a one-machine deploy.
- **Availability**: `fly scale count api=2` keeps one API machine serving while the other updates and survives a single-machine failure, for about the price of a coffee. Fly's health check restarts a machine whose `/health` fails. Neon's compute is managed and restored from storage on failure; history retention gives point-in-time recovery.
- **Schema changes**: Kotori's migrations run on API and worker startup (`effect_sql_migrations` tracks them). The migrator holds an exclusive lock on that table while it runs, so when the two groups start together one waits and then finds nothing left to apply. Managed Auth owns the `neon_auth` schema. Migrations are forward-only; write a new one rather than editing an applied one.
- **Rollback**: `fly releases` then `fly deploy --image <previous image>`; or restore the database to a point in time in Neon (or branch from one to inspect first).
- **Backups**: Neon's history retention is the backup; the dictionary and enrichment are rebuildable, learner data is not. Consider a periodic `pg_dump` to object storage once there are real learners.

## 4. Managed Better Auth (Neon Auth)

Identity is Neon's Managed Better Auth, declared with `auth: true` in `neon.ts`. How it fits together:

- **One origin for the app.** The API proxies `/api/auth/*` to `NEON_AUTH_BASE_URL` (`apps/api/src/http/neon-auth.ts` → `Auth.forward`), forwarding cookies and body and relaying `Set-Cookie`. Better Auth requires an `Origin` header; browsers send the web app's, native apps send none, so the proxy fills in the API's own public origin (from `x-forwarded-proto`/`host`). Both origins must be **trusted domains** on the branch (`neon neon-auth domain add https://…`); localhost is allowed by default.
- **Two credentials.** Web clients use the relayed session cookie; the API checks it upstream (`/get-session`). The app calls `GET /api/auth/token` with its cookie to get a 15-minute EdDSA **JWT** and sends it as `Authorization: Bearer`; the API verifies it locally against `NEON_AUTH_JWKS_URL` (`jose`), no round trip. Issuer and audience are the auth endpoint's origin. Revocation lag is bounded by the token lifetime.
- **Identity in our database.** Users and sessions live in the `neon_auth` schema of the same Postgres (user ids are uuids). The CLI lists users and looks up emails with SQL there; `kotori revoke` deletes `neon_auth.session` rows; account deletion (`DELETE /account/me`, authenticated by cookie or JWT) removes the profile and then the `neon_auth.user` row, whose sessions and accounts cascade. Managed Auth does not expose Better Auth's `/delete-user`, so this is the deletion path.
- **Approval state is Kotori's.** The managed user record has no custom fields, so `status` and `role` live on the `users` profile. `kotori requests` shows every managed user with the profile's status (pending until a row exists); `approve`/`archive`/`admin` create the profile row if the learner hasn't opened the app yet. The welcome email is in the learner's chosen language once they've onboarded, English before.

### Still to do before launch

| Item | Why | How |
| --- | --- | --- |
| Email webhooks | Managed Auth's own verification/reset emails are off (`sendVerificationEmailOnSignUp: false`); learners currently get no verification mail. Resend + Kotori's EN/JA templates return via webhooks. | API endpoint for `send.otp` / `send.magic_link` (EdDSA-signed payloads), then `neon neon-auth config webhook update --enabled --url https://api…/webhooks/neon-auth --enabled-events send.otp,send.magic_link`. Verification becomes a code, not a link. |
| Trusted domains | Proxy and web origins must be allow-listed; disable localhost in production. | `neon neon-auth domain add https://api.kotori.app` (and the web origin); `neon neon-auth domain allow-localhost disable`. |
| Custom sender / app name | Production checklist. | `neon neon-auth config email-provider update …`; app name in the console. |
| App sign-in screens | The Expo app has no auth UI yet; it only loads an existing session. | Call `/api/auth/sign-up/email`, `/sign-in/email`, then `/api/auth/token`; store the JWT (refresh on 401), send it as Bearer; set `nativeLanguage` via `PATCH /account/me` right after sign-up so approval emails use it. |
| `neon_auth` writes | `revoke` and account deletion write to managed tables directly. Standard Better Auth schema, FK cascades verified, but a Neon schema change could bite. | Re-check on Neon upgrades; the admin API (`/admin/revoke-user-sessions`, `/admin/remove-user`) is the sanctioned alternative if an admin session becomes convenient. |

Local development: `neon checkout <branch>` writes that branch's `DATABASE_URL`, `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` into `.env.local` (loaded after `.env`). There is no auth server without a Neon branch, so the branch-first flow is how the API runs locally; `--no-env-pull` with Docker Postgres only serves the worker and the repository tests.

## 5. CI and deploys

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`:

1. `pnpm install --frozen-lockfile` on the Node from `.node-version`, with the pnpm store and `.nx/cache` cached.
2. `nx sync:check` (project references match `package.json` dependencies), `pnpm format:check`, `pnpm lint`.
3. `nx affected -t typecheck test build` against the base commit (`nrwl/nx-set-shas`). Tests need no services: repositories run on PGlite and auth on an in-memory server.
4. On `main`, after the checks: `flyctl deploy --remote-only`. The job runs only when the repository variable `FLY_DEPLOY` is `true` and uses the `FLY_API_TOKEN` secret, a deploy token scoped to the app (`fly tokens create deploy -x 8760h`), which can deploy but not read secrets. Set both after `fly launch`.

Pull-request runs cancel superseded ones; runs on `main` never cancel, because they deploy. Deploys use the `production` environment, so GitHub can require a reviewer there if wanted.

## 6. Follow-ups

- **Image size.** The runtime image is ~176 MB (28 packages in `node_modules`). Watch for regressions: the workspace's hoisted linker resolves *optional* peer dependencies workspace-wide, so a server dependency with optional React or Expo peers would pull the app's toolchain into the image again (this is what `better-auth` did). If that happens, give `apps/app` its own pnpm workspace.
- **Nx 24** (`pnpm nx migrate latest`): `@nx/js/typescript` becomes the only typecheck provider, affected tasks are selected by default, and `nx format` detects Oxfmt.
- **Type-aware lint rules** once Oxlint can use the TypeScript 7 API.
- **Dedicated database role** for the apps instead of the Neon project owner, with the `neon_auth` grants replicated.
- **Staging**: a Neon branch plus a second Fly app (`fly launch` with another name); `fly.toml` needs no changes.
- Observability beyond structured logs.
