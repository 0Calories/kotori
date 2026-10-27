# Restructuring: a `services` package as the application layer

> Working document, agreed in outline on 2026-10-27 and parked until the Drizzle rebuild
> (docs/data-model-rebuild.md) has cut over. Pick it up from "Steps" below.

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
package stops depending on `domain` once `records.ts` moves out.

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

## Open questions to settle when picking this up

- Whether `EntryRecord` (JMDict's shape) belongs in `domain` (it is an input format, not
  API vocabulary) or in `services/dictionary`. Leaning `services/dictionary`.
- Whether services expose domain shapes (`Profile`, `StudyCard`) or their own, with the
  API doing the final mapping. Leaning domain shapes, since the API should stay a thin
  router and the worker CLI prints the same things.
- Whether to keep millisecond epochs in the SRS code or move it to `Date`. Not blocking:
  the service converts either way.
