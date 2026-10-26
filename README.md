# Kotori ことり

Kotori helps intermediate and advanced learners **sound natural** — in Japanese if you speak English, in English if you speak Japanese. Its mascot is a shima enaga (シマエナガ), Hokkaido's snowball of a bird.

- **Dictionary** — all of [JMDict](https://www.edrdg.org/jmdict/j_jmdict.html) (≈219k entries), searchable in English, Japanese or rōmaji. Conjugated forms work too: 食べなかった finds 食べる.
- **Nuance** — every sense gets judged for formality, speech vs. writing, keigo, speaker gender and age, how current it feels, connotation and learner pitfalls ("too casual for your boss"), plus similar words and how they differ. Judgments come from TypeSafe's **Jev**; JMDict's own usage tags override them where they exist.
- **Examples and pronunciation** — a separate worker writes natural example sentences per meaning with **Claude** (with furigana) and voices headwords and sentences with **ElevenLabs**.
- **Naturalness check** — write a sentence in the language you're learning; Kotori says how a native hears it, what to fix and how a native would say it.
- **How do I say…** — describe what you mean in your own language; get the ways natives actually say it, with literal glosses, register, key words and pitfalls.
- **Review** — save any word or phrase; cards are scheduled with Anki's SM-2 algorithm (learning steps, ease, lapses, fuzz, leeches).

The app runs on iOS, Android and the web from one Expo codebase, in English or Japanese depending on who's learning.

<p align="center">
  <img src="docs/screenshots/onboarding.jpg" width="200" alt="Onboarding">
  <img src="docs/screenshots/search.jpg" width="200" alt="Searching “eat”, with each word's formality from Jev">
  <img src="docs/screenshots/entry.jpg" width="200" alt="食べる with its nuance and similar words">
  <img src="docs/screenshots/review.jpg" width="200" alt="A review card with Anki's next intervals">
</p>

## Monorepo

An [Nx](https://nx.dev) workspace using pnpm. Back end and data layer are TypeScript on [Effect 4](https://effect.website).

```
apps/
  api/        HTTP API (Effect HttpApi): dictionary, coach, study, audio
  worker/     CLI + job worker: seed JMDict, enrich with Jev / Claude / ElevenLabs
  app/        Expo (Router) app for iOS, Android and web
packages/
  domain/     Schemas and the HttpApi contract shared by the API and the app (typed client)
  db/         Postgres layer (@effect/sql-pg), migrations, repositories, full-text search
  jmdict/     Downloads and parses EDRDG's JMdict_e, imports it
  japanese/   Romaji ↔ kana, script detection, Yomichan-style deinflection
  nuance/     Jev questions, state building and interpretation for nuance + similar words
  ai/         Claude service, coach prompts, example-sentence writer
  tts/        ElevenLabs client, content-addressed audio store, monthly budget guard
  srs/        Anki's SM-2 scheduler (v3), pure and fully tested
tools/        Renders the mascot into app icons
```

`nx graph` shows how they fit together.

## Getting started

Requires **Node 24** (pinned in `.node-version`), **pnpm 12** (pinned in `package.json`, installed by Corepack or `pnpm self-update`) and a **Postgres** to point `DATABASE_URL` at (default `postgres://localhost:5432/kotori`), e.g.:

```sh
docker run -d --name kotori-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=kotori -p 5432:5432 postgres:17-alpine
```

```sh
pnpm install
cp .env.example .env        # add your API keys (see below)
pnpm seed                   # downloads JMDict (~10 MB) and imports it (~25 s)
pnpm kotori dev-account     # the development account the app signs in as
pnpm dev                    # API on :4000 + enrichment worker
pnpm dev:app                # Expo: press w for web, i for iOS, a for Android
```

The app finds the API on the same host as the Expo dev server, so it works from a simulator or a phone on the same network. Set `EXPO_PUBLIC_API_URL` to point it elsewhere.

Interactive API docs are served at <http://localhost:4000/docs> (OpenAPI at `/openapi.json`).

### API keys

| Variable | Used for | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Naturalness check, How do I say, example sentences | Coach features show "not set up"; no examples |
| `TYPESAFE_API_KEY` | Nuance and similar words (Jev) | Entries show meanings without nuance |
| `ELEVENLABS_API_KEY` | Pronunciation audio | No audio buttons |

The Anthropic SDK also picks up `ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile. Other settings (models, voices, paths, port, limits) are listed in `.env.example`.

## Enrichment

Looking at an entry in the app queues any missing enrichment at high priority; the worker (`pnpm dev` runs it) picks it up and the app updates itself when it's done. To backfill ahead of time, most frequent words first:

```sh
pnpm kotori enrich nuance --limit 2000      # Jev
pnpm kotori enrich examples --limit 500     # Claude
pnpm kotori enrich audio --limit 100        # ElevenLabs
pnpm kotori status                          # coverage and queue
```

Runs skip entries that are already done, so they can be repeated or interrupted safely.

**How nuance is judged.** For each sense Jev sees the word, that sense's meaning, its part of speech and JMDict's usage notes, and answers independent questions in one request: two scores (formality, speech ↔ writing), five choices (keigo type, gender, age group, currency, connotation) and three yes/no cautions. Similar-word candidates come from JMDict cross-references and words sharing an exact gloss; for each, Jev judges whether it's a near-synonym and how it differs (more casual, humble, broader…). Code combines the answers: JMDict tags such as `hon`, `col` or `male` win over Jev; low-confidence judgments are shown faded; raw distributions are stored so labels can be re-derived without re-running inference. The model is pinned (`jev-1.13.0`) so stored confidences stay comparable.

**Examples** use Claude structured outputs validated with Effect Schema. Furigana is written inline as `{漢字|かんじ}` and checked against the sentence before it's shown.

**Audio** is cached by content hash (voice, model, text), so each clip is generated once. `KOTORI_AUDIO_MONTHLY_CHARS` (default 50,000) caps spend; headwords are voiced from their kana reading to avoid kanji misreadings.

Claude requests opt into server-side refusal fallbacks (`fallbacks: "default"`), so a safety-classifier decline is retried on Anthropic's recommended fallback model instead of failing.

## Accounts and sign-ups

Identity is handled by Neon's [Managed Better Auth](https://neon.com/docs/auth/overview), proxied by the API at `/api/auth/*`; users and sessions live in the `neon_auth` schema of the same Postgres. Learners sign up and sign in in the app with email and password, then confirm their email with a code. The app keeps Managed Auth's session (in the Keychain/Keystore on devices, as the browser's cookie on the web) and authenticates to the API with short-lived JWTs minted from it (`GET /api/auth/token`). Approval status and roles are Kotori's own, on the learner profile. Kotori is in private beta, so new accounts start **pending** and can only reach `/account` until approved:

```sh
pnpm kotori requests                  # sign-ups waiting for approval (--all includes archived)
pnpm kotori approve user@example.com  # unlocks the app and emails the learner
pnpm kotori archive user@example.com  # hides the request; nothing is sent
pnpm kotori users                     # every account
pnpm kotori admin admin@example.com     # admins skip approval (--remove to demote)
pnpm kotori revoke user@example.com    # signs them out of every device
```

For local work none of that is needed: `pnpm kotori dev-account` creates an account already confirmed, approved and past the language picker, and in development the app signs in as it on launch. The command is idempotent, so run it again on a new branch. Set `EXPO_PUBLIC_DEV_SIGN_IN=off` to use the real screens instead. Neither half reaches a release build, where `__DEV__` is false and the command refuses to run.

Kotori sends its own email through [Resend](https://resend.com) when `RESEND_API_KEY` is set; otherwise messages are printed to the log, which is enough for local development. That covers the approval email and, once Managed Auth's webhook points at the API (`POST /webhooks/neon-auth`, signature-checked; see `docs/operations.md`), the verification and password-reset codes, all in the learner's language. Running the API needs a Neon branch (`neon checkout <branch>` writes `DATABASE_URL` and `NEON_AUTH_BASE_URL` into `.env.local`).

## Development

```sh
pnpm test        # every package's tests (Vitest + @effect/vitest), then the token-limit hook tests
pnpm typecheck   # TypeScript 7 (tsc --build) across the workspace
pnpm build       # emits dist/ for the API, the worker and the packages they use
pnpm lint        # Oxlint (.oxlintrc.json), including type-aware rules
pnpm format      # Oxfmt (.oxfmtrc.json); `pnpm format:check` in CI
pnpm sync        # Nx keeps tsconfig project references in step with package.json
pnpm assets      # re-render icons and splash from the mascot geometry
```

### Pre-commit token limit

`pnpm install` points this clone at `.githooks`. The pre-commit hook rejects a staged file over **5,000 tokens** (tokens = bytes ÷ 4, so **20,000 bytes**). It reads the staged blob, so an edit that is not staged does not count, and deletions are ignored. Lockfiles, generated output, vendored trees, snapshots, and binary, image, and font assets are skipped. The ignore list is `NON_AUTHORED` in `tools/file-token-limit.ts` — add a lockfile name, directory, glob, or asset extension there.

When the hook fails, split the file: move each class, component, function, or test suite into a new file named for what it contains, re-export or import it from the original so callers keep working, keep the original under the limit, update imports, `git add`, and commit again. `pnpm test:token-limit` runs the hook's tests.

`git commit --no-verify` skips the hook. Use it for a small edit to a file that is already over the limit, or for a generated file the ignore list does not know yet; extend `NON_AUTHORED` for the latter when you can. New authored files should be split instead. These tracked files are already over the limit and fail only once they are staged: `apps/app/src/i18n/strings.ts`, `packages/auth/src/Auth.ts`, and `apps/app/app/entry/[id].tsx`.

Packages are TypeScript project references. Each one has a `tsconfig.lib.json` (source, emitted to `dist/`) and a `tsconfig.spec.json` (tests, type-checked only); `nx sync` derives the `references` between them from `package.json` dependencies, so importing a package you have not declared fails the typecheck. Their `exports` maps point `@kotori/source` at `src/` and everything else at `dist/`: `tsc`, `tsx -C @kotori/source`, Vitest and Metro read source, while `node dist/main.js` in production reads the compiled output.

CI (`.github/workflows/ci.yml`) runs `nx sync:check`, format and lint checks, the token-limit hook's typecheck and tests, then `nx affected -t typecheck test build`; a push to `main` deploys the API and worker to Fly.io once the checks pass, and the web app is built and served by Vercel from `vercel.json` (see `docs/operations.md`; what is still to be done by hand is in `docs/deploy.md`). Dependency versions shared across packages live in the `catalog:` of `pnpm-workspace.yaml`. TypeScript 7 is installed as `@typescript/native` (the `tsc` you run) alongside TypeScript 6 as `typescript` (the compiler API that Nx and editors still need; `tsc6`). Oxlint's type-aware rules run on `oxlint-tsgolint`, which embeds its own TypeScript 7.

Tests cover the SM-2 scheduler against Anki's behaviour, deinflection, JMDict parsing, repositories on an in-process Postgres ([PGlite](https://pglite.dev), no server needed), the Jev and ElevenLabs pipelines with fakes, structured-output schemas, and the HTTP API end to end through Effect's in-memory `HttpApiTest` client.

## Data and credits

Dictionary data is [JMDict](https://www.edrdg.org/jmdict/j_jmdict.html) by the Electronic Dictionary Research and Development Group, used under [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html). The app credits it in Settings. JMDict downloads land in `data/` and are not committed; everything else lives in Postgres.
