# Monorepo rearchitecture

> Agreed direction, 2026-10-28. This replaces the earlier services-package proposal.
> The Drizzle data-model rebuild has already landed; this document describes the next
> refactor, not the current layout. Implement the migration in the order below.

## Goal

Give each part of Kotori one clear owner: Drizzle defines stored data, contracts compose
the values exchanged with callers, AI modules produce content and judgments, and backend
features coordinate application behavior. Remove duplicated declarations and scattered
business rules while keeping the existing HTTP interface, CLI behavior, and separate API
and worker processes working throughout the migration.

Single responsibility means one reason to change, not one file or package per function.
A package can contain several focused modules behind a small interface. Package count is
not the success criterion; locality of changes and clear dependency direction are.

## Target layout

```text
apps/
  app/                          Expo application
  backend/                      One backend application / Nx project
    src/
      entrypoints/
        http.ts                 HTTP process
        worker.ts               Background worker process
        cli.ts                  Administrative and data commands
      http/                     Routes, auth middleware, codecs, CORS
      cli/                      Argument parsing and output
      worker/                   Polling loop and process lifecycle
      features/
        accounts/               Profiles, approvals, account lifecycle
        dictionary/             Search, entry assembly, vocabulary lookup
          import/               JMDict download, parser, input types, ingestion
        coaching/               Learner requests, caching, usage limits
        study/                  Notes, review queue, answering, statistics
        enrichment/             Requests, jobs, retries, enrichment workflows
        audio/                  Clip cache, spending policy, storage, retrieval
      integrations/
        auth/                   Managed Auth client, JWTs, webhook signatures
        email/                  Mail transport and shared rendering
      runtime/                  Environment loading and live layer composition
  local-auth/                   Development-only identity server
packages/
  ai/                           Typed model capabilities and provider adapters
  db/
    src/
      schema/                   Browser-safe tables, enums, structured values
      runtime/                  Database connection and migration implementation
      testing.ts                PGlite support
    migrations/
  contracts/                    Composed Effect schemas and HTTP contract
  japanese/                     Focused pure language helpers
  srs/                          Pure scheduling and shared review formatting
```

`apps/backend` replaces both `apps/api` and `apps/worker` as source projects. Its entry
points still run independently, with separate runtime layers and process configuration.
The HTTP process initializes only the dependencies it needs; worker and CLI composition
remain separate. HTTP continues as Fly's `api` process group, enrichment as `worker`,
and migration remains a release command rather than application startup work.

There is no new `packages/services` or `packages/backend`. The application-specific
workflows belong to the backend application. Nx also supports application-specific
libraries, but this repository does not need an extra project just to share those
workflows between backend entry points. The tradeoff is coarser affected detection for
the single backend project. See [Nx's folder-structure guidance](https://nx.dev/docs/kb/folder-structure).

Keep `japanese` and `srs` focused during this refactor: language helpers serve search and
AI preparation, and review formatting is consumed by Expo as well as the backend.
Backend-only helpers can live with their feature. Shared furigana parsing moves from
`domain` to `japanese`; the contracts package does not become a general algorithms library.

## Ownership and dependencies

```text
Expo ---------------------> contracts ------> db/schema
backend entry points -----> backend features -> contracts, ai, db/runtime, db/schema
backend features ---------> backend integrations
ai -----------------------> db/schema values, pure helpers as needed
db/runtime ---------------> db/schema
```

These are import dependencies, not network services. `ai` remains an in-process package.

- `db/schema` owns the persistent model and stored value vocabulary. It has no dependency
  on contracts, backend features, database drivers, or environment configuration.
- `contracts` imports the schema-only entry point, never the database runtime.
- AI modules may consume schema-only value definitions; they do not query or write data.
- Backend features own production application queries and transactions. Database
  implementation, migrations, database tests, and local-auth setup retain the access
  their infrastructure role requires.
- A feature calls another feature's interface rather than reaching into its private
  query helpers. For example, dictionary entry assembly requests enrichment through
  the enrichment module.
- Runtime dependencies flow toward model definitions and capabilities; none of those
  lower modules imports the backend application.

Expose deliberate package entry points, including `@kotori/db/schema`,
`@kotori/db/runtime`, and `@kotori/db/testing`. Keep Node drivers, credentials, migrations,
and test infrastructure out of the schema import graph. Preserve source and compiled
export conditions, and enforce the allowed imports with a lint or architecture check.

## One source of truth for data and contracts

Rename `packages/domain` to `packages/contracts` and narrow its responsibility. It holds
request and response schemas, the HTTP contract, public errors, and composition of model
schemas. It does not maintain a second set of database row definitions.

The installed Drizzle version includes `drizzle-orm/effect-schema`. Use its
`createSelectSchema`, `createInsertSchema`, and `createUpdateSchema` functions to derive
Effect schemas from tables, views, and enums, then compose the public contracts.
See [Drizzle's Effect schema integration](https://orm.drizzle.team/docs/effect-schema).

| Information | Owner and derivation |
| --- | --- |
| Columns, nullability, defaults, relations, constraints, indexes | Drizzle tables |
| Selected and inserted row types | `$inferSelect`, `$inferInsert`, or inferred query results |
| Persisted enum values | Drizzle enums; derive Effect schemas from them |
| Structured JSON such as `NoteContent` and `Nuance` | Explicit Effect schemas under `db/schema`; infer their TypeScript types |
| Unchanged public fields | Reuse generated field schemas |
| Public requests | Select permitted fields and add request-specific validation |
| Assembled responses | Compose model fields with explicit joined and computed values |
| Algorithm state | Define the algorithm's actual input; reuse model vocabulary where meanings match |

### Resolve the existing dependency cycle first

Today, Drizzle tables import types from `domain`. Before contracts import the tables,
move stored JSON value schemas and their required vocabulary, such as identifiers and
register values, into `db/schema`. Keep enum declarations, value schemas, and table
declarations in separate modules so their imports remain acyclic. Contracts re-export
or compose those definitions rather than maintaining copies.

For JSON columns, `$type<NoteContent>()` supplies compile-time typing; it does not
generate the nested runtime validator. Use the same explicit `NoteContent` schema as an
override when generating a table schema. Apply the same rule to `Nuance` and other
structured values. See [Drizzle's JSON typing documentation](https://orm.drizzle.team/docs/column-types#jsonb).

### Compose explicit public interfaces

For example, after the schema-only export exists:

```ts
import { accountStatus, users } from "@kotori/db/schema"
import { createSelectSchema, createUpdateSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"

export const AccountStatus = createSelectSchema(accountStatus)

const UserUpdate = createUpdateSchema(users, {
  dailyNewLimit: (schema) =>
    schema.check(Schema.isBetween({ minimum: 0, maximum: 9999 }))
})

export const UpdateProfileRequest = Schema.Struct({
  displayName: UserUpdate.fields.displayName,
  dailyNewLimit: UserUpdate.fields.dailyNewLimit
})
```

This abbreviated example demonstrates composition, not the complete existing request.
Keep the full permitted field set when implementing it. Select fields explicitly so
adding a database column does not automatically expose it in a response or allow a
client to update it. A table update schema alone is not an authorization policy.

Retain explicit definitions for differences that carry meaning:

- `Profile` combines identity-provider details with learner fields and derives
  `onboarded` from `onboardedAt`.
- `Entry` assembles dictionary tables, resolves tags, and adds romaji, audio URLs,
  similar words, and enrichment status.
- `ReviewQueue` and `StudyStats` describe computed results.
- Coaching contracts describe structured AI requests and results, not table rows.
- Dates, branded identifiers, and request validation require deliberate codecs or
  refinements where they differ from the generated schema.

Keep database dates as `Date` internally where practical, retain millisecond epochs at
the existing HTTP and SRS interfaces, and convert once at the owning operation. Audit
generated validation against the existing contract rather than changing accepted inputs
or serialized output as an incidental consequence of the refactor.

Schema derivation is runtime composition, not a new code-generation pipeline. It adds
Drizzle metadata to the client dependency graph. Verify the schema-only exports through
Metro and the web build, including their bundle contents. Revisit build-time generation
only if the measured client cost warrants it.

## AI package

Consolidate the model capabilities from `ai`, `nuance`, and `tts` into `packages/ai`:

```text
ai/src/
  coaching/       Coach, prompts, output validation, formality judgment
  examples/       ExampleWriter, prompts, output validation
  nuance/         NuanceJudge, questions, provider-answer interpretation
  speech/         Speech synthesis
  providers/      Claude, Jev, ElevenLabs adapters
  live.ts         Capability layer composition
```

Expose focused capability interfaces such as `Coach`, `ExampleWriter`, `NuanceJudge`,
and `Speech`. Provider adapters remain internal implementation seams where practical,
with test adapters for external calls. Consolidating the package does not require one
large Effect service or a universal interface for unlike provider operations.

AI owns prompts, structured-output validation, model configuration, provider retries,
provider errors, and interpretation of provider answers. Results include model identity
and usage metadata where the caller needs them for persistence or accounting. Each
capability reports its own availability; missing speech credentials do not disable
coaching or nuance. Preserve the distinction between configured and reachable providers.

Backend modules own candidate selection, missing-data checks, cache policy, learner rate
limits, spending limits, persistence, and jobs. For example, `NuanceJudge` receives word,
sense, notes, and candidate values; it does not receive a database record to look up or
an entry ID to persist. Dictionary-authoritative overrides belong with the feature's
normalization policy, separate from interpreting Jev's raw answers.

## Backend features and integrations

| Owner | Current code that moves here |
| --- | --- |
| `accounts` | API `Accounts`, auth `Approvals`, account webhook policy, CLI account workflows, learner and identity-table queries |
| `dictionary` | API `Dictionary` search, entry assembly, word lookup, `DictionaryRepo` queries |
| `dictionary/import` | JMDict download, parsing, input record schemas, batch ingestion |
| `coaching` | API `Coaching` naturalness and how-to-say workflows, coach caching and usage queries |
| `study` | API `Study`, `StudyRepo` queries, notes, queue, answering, statistics |
| `enrichment` | Worker `Enrichers` and `JobRunner` policies, `JobsRepo`, enrichment result queries and writes |
| `audio` | `Pronouncer` cache, spending policy and entry/example linking, `AudioStore`, generated clip retrieval |
| `integrations/auth` | Managed Auth proxy/client, token verification, key retrieval, signature verification |
| `integrations/email` | Resend, console and memory transports, shared email rendering |
| `runtime` | Live layer composition, environment and path loading currently housed in `db/Paths` |

The HTTP audio route handles HTTP response details; audio generation and retrieval belong
to the audio feature. Coaching can request speech through that feature. Entry/example
audio enrichment also calls the same feature so caching and budget rules have one owner.

Account-specific email copy lives with accounts. Authenticated webhook processing calls
the account workflow after signature verification. Session-existence queries and identity
deletion remain coordinated with account persistence; token verification receives the
necessary session-check dependency. Preserve atomic deletion of the identity and learner
data on their shared database connection.

Backend runtime owns application configuration loading; database runtime resolves migration
assets relative to its own package. Update local-auth and development setup to load their
configuration without importing backend feature code or restoring environment loading to
the browser-safe schema graph.

Within features:

- Prefer named Effect functions for application operations. Retain Effect service
  interfaces where they provide a useful seam, particularly external production/test
  adapters; an interface plus implementation is not inherently a code smell.
- Put a single-use query with its operation. Extract shared queries into a private module
  owned by that feature. Remove the generic repository layer as its callers migrate.
- Derive row shapes instead of mirroring columns. JMDict `EntryRecord` is an ingestion
  format and belongs under `dictionary/import`, not in contracts or database runtime.
- Own transactions at the operation that requires atomicity. Answering a card updates
  the card and inserts the review log together. Profile creation and defaults have one
  implementation shared by learner requests and approval commands.
- Keep the HTTP and CLI entry points small. Features return contract-shaped results
  where appropriate; delivery code handles request context, public error mapping, and
  output formatting rather than rebuilding the same result independently.
- Centralize enrichment availability, requests, priorities, retries, and follow-up work.
  Preserve stale-job recovery and interruption handling, and define example-to-audio
  follow-up consistently for queued work and CLI backfills.

## Migration sequence

Each step leaves the workspace buildable and the existing behavior verifiable. Temporary
wrappers may delegate to the new modules; remove them when their consumers switch.

1. **Establish schema-only dependencies.** Move stored value schemas and vocabulary out
   of `domain`; separate schema exports from database runtime and testing. Update table
   types, JSON-schema overrides, and repeated enum consumers, including SRS vocabulary.
   **Done when:** the model import graph is acyclic, `db` does not depend on `domain` or
   contracts, and schema-only imports initialize without drivers or environment loading.

2. **Replace `domain` with composed contracts.** Rename the package, update consumers,
   derive matching fields and enum schemas, retain explicit public field sets, and move
   furigana helpers to `japanese`. Preserve current encoded formats and validation.
   **Done when:** duplicate model declarations are removed, existing HTTP contract tests
   pass, and Expo/Metro plus the exported web application resolve the new imports.

3. **Create the backend application.** Introduce the shared feature tree and independent
   HTTP, worker, and CLI entry points. Move the existing implementations and tests first,
   retaining useful dependency injection and separate live runtime composition.
   **Done when:** all three entry points execute through the new backend project and the
   previous entry points, if still present, only delegate to it.

4. **Give features ownership of persistence.** Migrate study and coaching first, then
   accounts and dictionary queries. Consolidate profile creation. Make review-answer
   writes atomic and preserve transactional account deletion. Remove each repository
   once its operations are owned by the corresponding feature.
   **Done when:** these feature interfaces are covered on PGlite, atomic operations have
   rollback coverage, and their old repositories have no callers.

5. **Consolidate AI and backend-only packages.** Split nuance and speech generation from
   persistence, move capabilities into `ai`, and move enrichment/jobs/audio into backend
   features. Move JMDict under dictionary ingestion and auth/email under their backend
   owners. Wire both on-demand and administrative paths through the same workflows.
   **Done when:** AI capabilities require no database access, provider tests use fakes,
   feature integration tests cover persistence, and the old `nuance`, `tts`, `jmdict`,
   `auth`, and `email` packages and aggregate `Repositories` layer can be deleted.

6. **Cut over tooling and retire old paths.** Remove `apps/api`, `apps/worker`, and any
   transitional wrappers. Update workspace dependencies, project references, root scripts,
   package exports, CLI bin wiring, Docker filters/artifact copying, Fly process/release
   commands, and affected CI configuration. Update the README, operations, deployment,
   and account/auth documentation to the implemented layout.
   **Done when:** source development and compiled production entry points work, the CLI
   and migration command resolve their assets, separate Fly process groups are preserved,
   and no references to removed packages or output paths remain.

## Validation and completion

Preserve existing behavioral coverage as code moves. Move tests with the behavior they
exercise, and replace redundant implementation-level checks only when coverage through
the owning interface proves the same behavior.

- Test pure algorithms directly; keep existing scheduler and language
  behavior intact.
- Test AI capabilities through their interfaces with fake provider adapters, including
  independent availability and structured-output handling.
- Test backend features on PGlite with fake AI and email dependencies. Cover shared
  profile defaults and transaction rollback.
- Retain HTTP integration checks for authorization, responses, errors, and public field
  selection. Check generated-schema nullability, JSON structure, dates, and refinements.
- Retain job recovery, retry, interruption, and example/audio follow-up coverage, and
  verify CLI entry points against those same workflows.
- Run the repository's sync, typecheck, test, lint, format-check, and build checks at the final
  cutover. Verify Metro resolution, the web export, and the backend image's compiled
  HTTP, worker, CLI, and migration entry points without relying on source files.

The refactor is complete when model facts have one definition, contract differences are
explicit, each backend workflow owns its persistence, and all consumers use the new
entry points. Broader Expo route/UI restructuring, scheduler redesign, provider changes,
and wire-format redesign are separate follow-up work.
