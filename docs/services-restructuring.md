# Restructuring: a `services` package as the application layer

> Agreed in outline on 2026-10-27 and implemented on 2026-10-28, in the PR that adds
> `packages/services`. Kept as the record of why the code is laid out this way; "Outcome"
> at the end says where the implementation settled the open questions or departed from
> the plan.

## Goal

One source of truth for the data model and for data access, and no duplication of either.
The Drizzle schema in `packages/db/src/schema` is already the single source of truth for
the model. This restructuring makes the *access* side match: queries live in exactly one
place, owned by the code that implements Kotori's use cases, and nothing else talks to
the database.

## Why the repositories are not the end state

Phase 3 of the rebuild moved the six repositories onto Drizzle while keeping their shape.
They still declare every method twice (interface and implementation) and restate table
columns as row types. More importantly they exist to be *shared* between the API, the
worker, and the provider packages, which is a symptom: the application layer has no home
of its own, so persistence leaked into five packages and the delivery apps.

Repository usage today, outside `packages/db`:

| Repository | Callers |
|---|---|
| Dictionary | api, worker, jmdict, nuance, tts |
| Enrichment | api, worker, nuance, tts |
| Jobs | api, worker |
| Users | api, worker, auth |
| Study | api |
| Coach | api |

## Target layout

```
apps/
  api/          HTTP only: routing, auth middleware, CORS, request/response codecs
  worker/       CLI and job loop only: commands, scheduling, logging
  app/          Expo client (unchanged)
packages/
  domain/       Shared vocabulary: Effect Schemas for the API contract (unchanged)
  db/           Infrastructure: Drizzle schema, migrations, Database service, PGlite test layer
  services/     Application layer: use cases that own all data access   <-- new
  ai, nuance, tts, jmdict, email, japanese, srs
                Pure providers and algorithms: no database access
```

Dependency direction, strictly downward:

```
api ─┐
     ├─> services ─> db, domain, providers
worker ┘
```

- `services` is the only package that imports `Database` or the schema tables.
- Providers return data and never persist it. The service that calls a provider writes
  the result.
- `domain` stays free of persistence and of services.
- `auth` is the one package that is neither provider nor service today: it proxies Managed
  Auth, verifies JWTs, and reads `neon_auth`. It becomes a provider (upstream client and
  token verification only); the `neon_auth` reads and the approval flow move into
  `services/accounts`.

## Shape of a service

A service is a module of Effect functions that require `Database` (and providers), not a
class with an interface. One declaration per use case; tests provide `DatabaseMemory`.

```ts
// packages/services/src/study/queue.ts
export const dueCards = Effect.fn("study.dueCards")(function* (user: Profile, now: number) {
  const db = yield* Database
  const rows = yield* db
    .select(cardsWithContent)
    .from(cards)
    .innerJoin(notes, eq(notes.id, cards.noteId))
    .where(and(eq(cards.userId, user.id), lte(cards.due, new Date(now))))
  return rows.map(toStudyCard) // domain shape, milliseconds, branded ids
})
```

Rules of thumb:

- Row types are `typeof table.$inferSelect`; no hand-written mirrors. Conversion to domain
  shapes (millisecond epochs, branded ids) happens once, in the service, on the way out.
- A query used by one use case lives in that use case's module. A query used by several
  lives in the service module that owns the table (`dictionary/`, `enrichment/`), not in a
  generic repository.
- Transactions wrap use cases, not queries: `db.transaction` is called by the service
  function that needs atomicity.
- Services are the unit of integration testing, on PGlite, with providers stubbed.

## Services and what moves into them

| Service | Today | Moves in |
|---|---|---|
| `accounts` | `apps/api/src/services/Accounts.ts`, `packages/auth` `Approvals`, `Webhooks` (profile part), worker `commands/accounts.ts` logic | `UsersRepo`; `neon_auth` reads from `Auth` |
| `dictionary` | `apps/api/src/services/Dictionary.ts` (search, entry assembly, enrichment status) | `DictionaryRepo` queries; `JMDict.importFile`'s inserts (import becomes a service that consumes the parser) |
| `enrichment` | worker `Enrichers.ts`, `NuanceEnricher` persistence, `Pronouncer` cache and budget, `AudioStore` | `EnrichmentRepo`, `JobsRepo` |
| `study` | `apps/api/src/services/Study.ts` | `StudyRepo` |
| `coaching` | `apps/api/src/services/Coaching.ts` | `CoachRepo` |

Providers after the move, and what they stop doing:

- `jmdict`: download and parse only. Returns `EntryRecord`s (which move to `domain` or
  `services/dictionary`; `records.ts` leaves `db`).
- `nuance`: Jev client and judgment derivation only. Returns `NuanceInput`s.
- `tts`: ElevenLabs client only. Returns bytes. Cache lookup, budget check, and storage are
  `services/enrichment/audio.ts`.
- `auth`: Managed Auth proxy, JWT verification, webhook signature. Session existence
  check becomes a function the service passes in, as `makeVerifyToken` already allows.

## What `db` keeps

`schema/`, `migrations/`, `Database`, `DatabaseLive`, `DatabaseMemory`, `migrateDatabase`,
`neonAuth.ts`, and `rows.ts`-style converters if services share them. Nothing else. The
package stops depending on `domain` once `records.ts` moves out (it didn't; see "Outcome").

## Steps

Each step leaves the workspace green. Order chosen so the API keeps working throughout.

1. **Create `packages/services`** with the Effect/tsconfig/vitest scaffolding of an
   existing package, depending on `db`, `domain`, and the providers. Add a `Services`
   layer the apps provide once (it only needs `Database` and provider layers).
2. **Move the API services** (`Accounts`, `Study`, `Coaching`, `Dictionary`) into the
   package unchanged, then inline each repository they use and delete it:
   `StudyRepo` and `CoachRepo` first (single caller), then `UsersRepo` with the
   `Approvals` logic from `auth`.
3. **Build `services/enrichment`** from worker `Enrichers.ts`, `NuanceEnricher`'s
   persistence, `Pronouncer`'s cache and budget, and `AudioStore`; inline `EnrichmentRepo`
   and `JobsRepo`. The worker's `work` command becomes a loop over
   `enrichment.claimAndRun`.
4. **Build `services/dictionary/import.ts`** from `JMDict.importFile`; `jmdict` becomes
   parse-only; inline `DictionaryRepo`. Move `records.ts` out of `db`.
5. **Trim `auth`** to upstream proxy and token verification; move `neon_auth` reads to
   `services/accounts`.
6. **Delete `Repositories`** and the repository files; `db` no longer depends on `domain`.
   Update `docs/operations.md` and the README's package table.

## Outcome

Settled questions:

- **`EntryRecord` lives in `jmdict`**, next to the parser that produces it, not in
  `services/dictionary`: `jmdict` sits below `services` and returns it, so the type can't
  live above it. `services/dictionary` stores entries in that shape and reads them back in
  it; `nuance` takes it as input.
- **Services return domain shapes** (`Profile`, `StudyCard`, `Entry`), so the API maps
  nothing.
- **Millisecond epochs stay** in the SRS code and the domain; services convert from and to
  `Date` at their boundary (`rows.ts`).

Where the code departs from the plan:

- **`db` still depends on `domain`.** The schema types its `jsonb` and enum columns with
  domain types (`$type<Nuance>()`, `$type<AccountStatus>()`), which is what keeps the model
  and the API vocabulary one thing. `records.ts` was never the reason. `Paths.ts`
  (`loadDotEnv`, `resolveFromRoot`) stays in `db` too, as infrastructure the apps share.
- **The `Services` layer holds what services keep besides the database and providers:**
  settings read once at startup (`AudioSettings`, `CoachingLimits`) and in-process state
  (`AuthEmailDeliveries`, the webhook ids already emailed). `makeServices(providers,
  database)` adds the rest, and `ServicesLive` is the production composition both apps
  provide. `ServicesContext` names everything a use case may require.
- **API handlers capture the services' context** once per group, when its layer is built
  (`withServices` in `apps/api/src/http/services.ts`). A handler that required `Database`
  directly would turn it into a per-request router requirement, which `HttpRouter.serve`
  meets in production but nothing meets under `HttpApiTest`.
- **The API still imports `auth`**, only to proxy `/api/auth/*` (`Auth.forward`): a service
  wrapping a byte-for-byte proxy would add nothing.
- **The worker keeps the stale-job sweep's schedule** (once a minute, in `JobRunner.ts`);
  `Enrichment.claimAndRun` claims, runs and settles one job, and `Enrichment.requeueStale`
  decides what counts as stale.
- **Tests fake Managed Auth over the database.** `@kotori/services/testing` has `TestAuth`
  and `AuthMemory`, which keep users and sessions in a `neon_auth` stand-in that
  `DatabaseMemory` creates, so services read identity in tests exactly as in production.
