# How Kotori runs in production

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

## Environment

Set with `fly secrets set` unless marked plain (plain values live in `[env]` of `fly.toml`). Both process groups share the same secrets.

| Variable | Needed by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | api, worker | Neon direct (unpooled) string as pulled. Kotori's tables and the `neon_auth` schema live here. |
| `NODE_ENV` | api, worker | `production`, plain in `fly.toml`. JSON logs. |
| `PORT` | api | `8080`, plain in `fly.toml`. The API reads `KOTORI_PORT`, then `PORT`, then 4000. |
| `NEON_AUTH_BASE_URL` | api, worker | The branch's Managed Auth URL (`neon env pull` writes it). The API proxies `/api/auth/*` to it; the worker's account commands never call it (they use SQL) but the layer requires it. |
| `RESEND_API_KEY`, `KOTORI_EMAIL_FROM` | api, worker | Optional. Without a key, emails are logged instead. The API sends verification and reset codes (see Managed Better Auth), the worker approval emails. |
| `KOTORI_WEB_ORIGINS` | api | Comma-separated origins of the hosted web app (`https://app.kotori.app`), plain. The only browser origins allowed to call the API, with credentials, so the web app's session cookie reaches `/api/auth/*`. Outside production, local dev servers (`http://localhost:*`, private-network IPs) are allowed too. Native apps send no Origin and don't need it. |
| `ANTHROPIC_API_KEY` | api, worker | Optional. Coach features (api), example sentences (worker). |
| `TYPESAFE_API_KEY` | worker | Optional. Nuance via Jev. |
| `ELEVENLABS_API_KEY` | api, worker | Optional. Pronunciation audio; `KOTORI_AUDIO_MONTHLY_CHARS` caps spend. Voices come from the cast in `packages/tts/src/voices.ts` (see `docs/voice-casting.md`); `KOTORI_HEADWORD_VOICES` caps clips per headword. |

Every optional provider degrades gracefully: `/health` reports which features are on, and the API queues enrichment only for configured providers. `.env.example` has the full list with defaults.

### Keeping the keys worth less

The platform's secret store is one layer; assume it can fail. Use **separate API keys for production** at Anthropic, ElevenLabs, TypeSafe and Resend, each with a **hard spend cap** at the provider, so a leaked key is bounded and revocable without touching development. Rotate by `fly secrets set` plus a deploy. If you want keys to never sit in any hosting dashboard, a secrets manager (Doppler, Infisical, 1Password) can inject them at deploy time; the app only reads environment variables, so nothing changes in code.

## Day two

- **Sign-ups**: `fly ssh console --process-group worker -C "node apps/worker/dist/main.js requests|approve|archive|users|admin|revoke …"` — the same `kotori` CLI as locally (`pnpm kotori …`), against production. Or run it from a laptop with `DATABASE_URL` set; Neon doesn't care where the client is.
- **Enrichment coverage and queue**: `… status`, per dictionary. Backfill in bulk with `… enrich --help` (`--dictionary english` for the English words Japanese speakers see).
- **Dictionaries**: `… seed` imports JMDict and the English dictionary and re-imports them in place, keeping ids, enrichment and saved words; `--dictionary jmdict|english` does one. Enrichment and saved words are keyed by sense position, so a re-import matches each entry's senses by their glosses and moves what hangs off a sense with it, wherever the import puts it now; only a sense that can't be matched loses its enrichment (docs/nuance-on-english-entries.md). The English import ranks senses commonest first (`commonestFirst` in packages/eiwa), so re-seed it with `--dictionary english` after a change to the ranking, as after the release that introduced it. The English import streams its ~430 MB Wiktionary download and peaks at about 500 MB of memory, which the worker machine doesn't have to spare, so run it from a laptop with the production `DATABASE_URL` set (`pnpm kotori seed --dictionary english`, about a minute), as Neon doesn't care where the client is. A full import removes English words its sources no longer have.
- **Logs**: `fly logs` (add `--process-group api`); JSON lines, one per request with method, path, status and span duration. Metrics and a Grafana dashboard come with the app.
- **Deploys**: every push to `main` that passes CI and reaches the API, the worker or what they ship runs `flyctl deploy --remote-only` (see CI and deploys); `fly deploy` from a laptop does the same. Strategy is rolling. With one machine per group, the worker stops before its replacement starts, so two workers never process the queue at once during a deploy. On SIGTERM the worker puts its in-flight enrichment back in the queue (the attempt doesn't count) and exits, and the replacement picks it up; a job left `running` by a worker that crashed or was SIGKILLed is requeued once it is 10 minutes old (`requeueStale`, checked every minute). The API drains in-flight requests for up to 20 s; `kill_timeout = 60` is the ceiling for both. If the database is unreachable the worker backs off (1 s doubling to 1 min) rather than exiting, so an outage doesn't use up Fly's restart retries. The API is briefly unavailable during a one-machine deploy.
- **Availability**: `fly scale count api=2` keeps one API machine serving while the other updates and survives a single-machine failure, for about the price of a coffee. Fly's health check restarts a machine whose `/health` fails. Neon's compute is managed and restored from storage on failure; history retention gives point-in-time recovery.
- **Schema changes**: the data model is the Drizzle schema in `packages/db/src/schema`; `pnpm --filter @kotori/db generate` diffs it into a migration under `packages/db/migrations`, and `kotori migrate` applies pending ones (recorded in `drizzle.__drizzle_migrations`). In production that command is Fly's `release_command`, run once per deploy before the new machines roll; the API and worker never migrate at startup. Managed Auth owns the `neon_auth` schema and drizzle-kit is told to leave it alone. Migrations are forward-only; write a new one rather than editing an applied one.
- **Rollback**: `fly releases` then `fly deploy --image <previous image>`; or restore the database to a point in time in Neon (or branch from one to inspect first).
- **Backups**: Neon's history retention is the backup; the dictionary and enrichment are rebuildable, learner data is not. Consider a periodic `pg_dump` to object storage once there are real learners.

## Managed Better Auth (Neon Auth)

Identity is Neon's Managed Better Auth, declared with `auth: true` in `neon.ts`. How it fits together:

- **One origin for the app.** The API proxies `/api/auth/*` to `NEON_AUTH_BASE_URL` (`apps/api/src/http/neon-auth.ts` → `Auth.forward`), forwarding cookies and body and relaying `Set-Cookie`. Better Auth requires an `Origin` header; browsers send the web app's, native apps send none, so the proxy fills in the API's own public origin (from `x-forwarded-proto`/`host`). Both origins must be **trusted domains** on the branch (`neon neon-auth domain add https://…`); localhost is allowed by default.
- **Two credentials.** The long-lived one is Managed Auth's session cookie (`__Secure-neonauth.session_token`, HttpOnly). The app trades it at `GET /api/auth/token` for a 15-minute EdDSA **JWT**, which it keeps in memory only, renews a minute before expiry or after a 401, and sends as `Authorization: Bearer`. How the cookie is kept differs by platform (`apps/app/src/auth/transport*.ts`). **Native** apps read it from `Set-Cookie` on the proxied sign-in and sign-up responses, keep only the `*.session_token` cookie in the Keychain/Keystore (SecureStore), and send it back as a `Cookie` header to `/api/auth/*` alone, with `credentials: "omit"` so the OS cookie jar plays no part. This is what Better Auth's own Expo plugin does, and it needs nothing from Managed Auth beyond the cookie: the bearer plugin, which would let the sign-in body's token stand in, isn't among Neon's supported plugins. On the **web**, scripts can't read the cookie, so the browser keeps it and `/api/auth/*` is called with `credentials: "include"`, which the API's CORS allows for `KOTORI_WEB_ORIGINS`. A 401 from `/token` (session revoked, deleted or expired), or the API refusing a freshly minted JWT, signs the app out; a 5xx keeps everything (offline). The API also still accepts the cookie itself (checked upstream with `/get-session`). It verifies JWTs locally (`jose`, against the key set at `NEON_AUTH_BASE_URL` + `/.well-known/jwks.json`), with no round trip to Managed Auth, then checks that the user still has a row in `neon_auth.session`, so `kotori revoke` and account deletion cut off outstanding JWTs at once rather than when they expire. Issuer and audience are the auth endpoint's origin. If Managed Auth or its key set can't be reached, the API answers 503 (`AuthUnavailable`), never 401, so clients keep their credentials.
- **Identity in our database.** Users and sessions live in the `neon_auth` schema of the same Postgres (user ids are uuids). The CLI lists users and looks up emails with SQL there; `kotori revoke` deletes `neon_auth.session` rows; account deletion (`DELETE /account/me`, authenticated by cookie or JWT) removes the profile and the `neon_auth.user` row in one transaction; sessions and accounts cascade. Managed Auth does not expose Better Auth's `/delete-user`, so this is the deletion path.
- **Approval state is Kotori's.** The managed user record has no custom fields, so `status` and `role` live on the `users` profile. `kotori requests` shows every managed user with the profile's status (pending until a row exists); `approve`/`archive`/`admin` create the profile row if the learner hasn't opened the app yet. The welcome email is in the learner's chosen language once they've onboarded, English before.
- **Email is Kotori's too.** Subscribed to `send.otp` and `send.magic_link`, Managed Auth sends no email of its own and POSTs each code or link to `/webhooks/neon-auth` (`apps/api/src/http/webhooks.ts` → `AuthWebhooks` in `packages/auth`). The API verifies Neon's signature as documented (a detached Ed25519 JWS over the timestamp and the raw body, key named by `X-Neon-Signature-Kid` from the same key set as the JWTs, at most 5 minutes old) before reading anything, and refuses anything else with 401. It then sends the verification, password-reset or sign-in email through the same mailer as the approval email, in the same language. Neon retries 5xx (but not other 4xx) up to three times within 15 s, so an unreachable key set answers 503 and a Resend failure 502; a retry of an event already sent on that machine is acknowledged without sending again. SMS codes and events without an address are refused (422); other event types are acknowledged and ignored.

`revoke` and account deletion write to the managed `neon_auth` tables directly. It is the standard Better Auth schema and the cascades are verified, but re-check on Neon upgrades; the admin API (`/admin/revoke-user-sessions`, `/admin/remove-user`) is the sanctioned alternative if an admin session becomes convenient.

### Email: registering the webhook

The endpoint is in the API; pointing Managed Auth at it is a one-time step per branch, after `RESEND_API_KEY` and `KOTORI_EMAIL_FROM` are set on Fly (without a key the codes are only written to the log) and the API answers on its public hostname. Neon only delivers to a public HTTPS hostname (no localhost, IPs or redirects), so for a dev branch use a tunnel's HTTPS URL. Run against the branch the API uses (`.neon` links one; add `--branch <name>` otherwise):

```sh
# Verification by code rather than link (the templates support both). Leave
# --send-verification-email-on-sign-up off (Neon's default): the app asks for the code
# right after sign-up, once it has saved the learner's language, so the code arrives in it.
neon neon-auth config email-password update --email-verification-method otp
# --enabled-events takes the events space-separated. 10 s per attempt leaves Resend's own retries room (Neon's cap is 15 s overall).
neon neon-auth config webhook update --enabled --url https://<api host>/webhooks/neon-auth \
  --enabled-events send.otp send.magic_link --timeout 10
neon neon-auth config webhook get          # enabled, the URL, both events
```

To check it, trigger a code (request a verification email from the app) and watch `fly logs --process-group api` for `Sent the email-verification email`; a `Managed Auth webhook not delivered` warning names the reason. `neon neon-auth config webhook update --no-enabled` returns delivery to Managed Auth's own emails.

Local development: by default `pnpm dev` runs `apps/local-auth`, a stand-in for Managed Auth on the Docker Postgres from `compose.yaml` (see the README). To test against Managed Auth itself, `neon checkout <branch>` writes that branch's `DATABASE_URL`, `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` into `.env.local` (loaded after `.env`), and the stand-in stays off.

## CI and deploys

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`:

1. `pnpm install --frozen-lockfile` on the Node from `.node-version`, with the pnpm store and `.nx/cache` cached.
2. `nx sync:check` (project references match `package.json` dependencies), `pnpm format:check`, `pnpm lint`.
3. `nx affected -t typecheck test build` against the base commit (`nrwl/nx-set-shas`). Nx selects only the tasks whose inputs the change reaches (plus the tasks those depend on), so editing a test typechecks and tests without re-exporting the web app; a task's `inputs` are therefore what decides whether CI runs it. Tests need no services: repositories run on PGlite and auth on an in-memory server.
4. On `main`, after the checks: `nx affected -t deploy`, against the last commit whose whole run (deploy included) succeeded, so a failed deploy is retried by the next push. Two projects have a `deploy` target, and the same rule about `inputs` decides which run:
   - `@kotori/api:deploy` deploys the Fly app, API and worker both, with `flyctl deploy --remote-only`. It depends on the API's and the worker's builds and reads their outputs, so a change to either, or to any package they use, selects it; so do `Dockerfile`, `.dockerignore`, `fly.toml` and the database migrations. It uses the `FLY_API_TOKEN` secret, a deploy token scoped to the app (`fly tokens create deploy -x 8760h`), which can deploy but not read secrets.
   - `@kotori/app:deploy` deploys the web app to Vercel from CI: `vercel pull` fetches the production environment and project settings, `vercel build --prod` builds against them, and `vercel deploy --prebuilt --prod` uploads the result. The Vercel CLI is a pinned devDependency of the app. It uses the `VERCEL_TOKEN` secret and the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` repository variables.

   `nx affected -t deploy --explain` (with `--base`/`--head` or `--files`) shows which deploys a change selects and why, without running them. Either deploy also runs by hand, as `pnpm nx run @kotori/api:deploy` with flyctl signed in, or `pnpm nx run @kotori/app:deploy` with the Vercel CLI signed in and linked (`.vercel/`, gitignored).

Pull-request runs cancel superseded ones; runs on `main` never cancel, because they deploy. Deploys use the `production` environment, so GitHub can require a reviewer there if wanted.

## The web app on Vercel

The Expo app exports to a static single-page bundle (`output: "single"` in `app.json`). `vercel.json` at the repository root carries the parts that are properties of this repository rather than of the hosting: the build command, the output directory (`apps/app/dist`), no framework preset, and a catch-all rewrite to `index.html` so a deep link survives a cold load (Vercel checks the filesystem before rewrites, so hashed assets still serve directly). It also turns off Git deployments for `main` (`git.deploymentEnabled`), so production deploys come only from CI, after the checks pass; other branches still get preview deployments from Vercel's Git integration. Install behaviour, Node version and caching are project settings. The paths are relative to the repository root, so the project's Root Directory stays there.

`EXPO_PUBLIC_API_URL` is inlined into the bundle at build time, so it is a build input set in the Vercel project per environment; changing it means a redeploy. Unset, the app falls back to the host serving the page on port 4000. Browser sign-in additionally needs the web origin in `KOTORI_WEB_ORIGINS` on the API and as a Managed Auth trusted domain; native apps send no `Origin` and need neither.

## Follow-ups

- **Image size.** The runtime image is ~176 MB (28 packages in `node_modules`). Watch for regressions: the workspace's hoisted linker resolves *optional* peer dependencies workspace-wide, so a server dependency with optional React or Expo peers would pull the app's toolchain into the image again (this is what `better-auth` did). If that happens, give `apps/app` its own pnpm workspace.
- **Preview environments**: a Neon branch and Fly app per preview, so Vercel previews reach a backend of their own rather than production — navigable without signing in, with the AI-backed endpoints refused server-side so preview traffic can't spend on Claude, Jev or ElevenLabs .
- **Dedicated database role** for the apps instead of the Neon project owner, with the `neon_auth` grants replicated.
- **Staging**: a Neon branch plus a second Fly app (`fly launch` with another name); `fly.toml` needs no changes.
- Observability beyond structured logs.
