import { Claude, Jev, Pronouncer } from "@kotori/ai"
import { CurrentUser, InvalidRequest, KotoriApi, NotFound } from "@kotori/contracts"
import * as Sentry from "@sentry/effect/server"
import { Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Database } from "../db/Database.ts"
import { Accounts } from "../features/accounts/Accounts.ts"
import { Asks } from "../features/asks/Asks.ts"
import { Coaching } from "../features/coaching/Coaching.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { entryCount, getEntries } from "../features/dictionary/index.ts"
import { liveEntry } from "../features/dictionary/live.ts"
import { EnrichmentUpdates } from "../features/enrichment/EnrichmentUpdates.ts"
import { Study } from "../features/study/Study.ts"
import { Mailer } from "../integrations/email/Mailer.ts"

const VERSION = "0.1.0"

const orNotFound =
  <A>(message: string) =>
  (option: Option.Option<A>) =>
    Option.match(option, { onNone: () => Effect.fail(new NotFound({ message })), onSome: Effect.succeed })

const SystemHandlers = HttpApiBuilder.group(
  KotoriApi,
  "system",
  Effect.fn(function* (handlers) {
    const claude = yield* Claude
    const jev = yield* Jev
    const pronouncer = yield* Pronouncer
    const mailer = yield* Mailer
    const db = yield* Database
    return handlers.handleAll({
      health: () =>
        Effect.gen(function* () {
          return {
            ok: true,
            version: VERSION,
            features: {
              coach: yield* claude.available,
              nuance: jev.configured,
              audio: pronouncer.configured,
              email: mailer.configured
            },
            dictionary: { entries: yield* entryCount(db) }
          }
        })
    })
  })
)

const AccountHandlers = HttpApiBuilder.group(
  KotoriApi,
  "account",
  Effect.fn(function* (handlers) {
    const accounts = yield* Accounts
    return handlers.handleAll({
      me: () => Effect.map(CurrentUser, (user) => user.profile),
      update: ({ payload }) => Effect.flatMap(CurrentUser, (user) => accounts.update(user.profile, payload)),
      delete: () => Effect.flatMap(CurrentUser, (user) => accounts.delete(user.id))
    })
  })
)

const DictionaryHandlers = HttpApiBuilder.group(
  KotoriApi,
  "dictionary",
  Effect.fn(function* (handlers) {
    const dictionary = yield* Dictionary
    const updates = yield* EnrichmentUpdates
    const db = yield* Database
    const asksService = yield* Asks
    return handlers.handleAll({
      // Learners search the dictionary of the language they're learning.
      search: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) =>
          dictionary.search(query.q, user.profile.targetLanguage, Math.min(Math.max(query.limit ?? 30, 1), 100))
        ),
      // Looking is read-only; only `enrich` (an approved learner's explicit request) queues work.
      entry: ({ params }) => dictionary.entry(params.id).pipe(Effect.flatMap(orNotFound("No such entry"))),
      enrich: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) =>
          dictionary.requestEnrichment(params.id, user.profile).pipe(Effect.flatMap(orNotFound("No such entry")))
        ),
      updates: ({ params }) =>
        getEntries(db, [params.id]).pipe(
          Effect.flatMap((found) =>
            found.length === 0
              ? Effect.fail(new NotFound({ message: "No such entry" }))
              : Effect.succeed(liveEntry(dictionary, updates, params.id))
          )
        ),
      ask: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* Effect.sync(() => Sentry.setUser({ id: user.id }))
          return yield* asksService.ask(user.profile, payload.q)
        }),
      asks: () => Effect.flatMap(CurrentUser, (user) => asksService.asks(user.profile))
    })
  })
)

const CoachHandlers = HttpApiBuilder.group(
  KotoriApi,
  "coach",
  Effect.fn(function* (handlers) {
    const coaching = yield* Coaching
    return handlers.handleAll({
      naturalness: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* Effect.sync(() => Sentry.setUser({ id: user.id }))
          return yield* coaching.naturalness(user.profile, payload)
        }),
      howToSay: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* Effect.sync(() => Sentry.setUser({ id: user.id }))
          return yield* coaching.howToSay(user.profile, payload)
        })
    })
  })
)

const AudioHandlers = HttpApiBuilder.group(
  KotoriApi,
  "audio",
  Effect.fn(function* (handlers) {
    const coaching = yield* Coaching
    return handlers.handleAll({
      speak: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* Effect.sync(() => Sentry.setUser({ id: user.id }))
          return yield* coaching.speak(user.profile, payload)
        })
    })
  })
)

const StudyHandlers = HttpApiBuilder.group(
  KotoriApi,
  "study",
  Effect.fn(function* (handlers) {
    const study = yield* Study
    return handlers.handleAll({
      notes: () => Effect.flatMap(CurrentUser, (user) => study.notes(user.profile)),
      addNote: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          if (payload.content.kind === "phrase" && payload.content.text.trim().length === 0) {
            return yield* new InvalidRequest({ message: "A phrase needs some text" })
          }
          return yield* study.addNote(user.profile, payload)
        }),
      removeNote: ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          // Already gone is success, so deleting twice does not fail. Someone else's
          // note is NotFound and is left in place.
          if ((yield* study.removeNote(user.profile, params.id)) === "forbidden") {
            return yield* new NotFound({ message: "No such note" })
          }
        }),
      queue: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) => study.queue(user.profile, Math.min(Math.max(query.limit ?? 50, 1), 200))),
      answer: ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const result = yield* study.answer(user.profile, params.id, payload.rating, payload.durationMs)
          return yield* orNotFound<typeof result extends Option.Option<infer A> ? A : never>("No such card")(result)
        }),
      stats: () => Effect.flatMap(CurrentUser, (user) => study.stats(user.profile))
    })
  })
)

export const AllHandlers = Layer.mergeAll(
  SystemHandlers,
  AccountHandlers,
  DictionaryHandlers,
  CoachHandlers,
  AudioHandlers,
  StudyHandlers
)
