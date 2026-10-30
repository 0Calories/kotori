import { Claude } from "@kotori/ai"
import { DictionaryRepo } from "@kotori/db"
import { CurrentUser, InvalidRequest, KotoriApi, NotFound } from "@kotori/domain"
import { Mailer } from "@kotori/email"
import { Jev } from "@kotori/nuance"
import { Pronouncer } from "@kotori/tts"
import { Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Accounts } from "../services/Accounts.ts"
import { Coaching } from "../services/Coaching.ts"
import { Dictionary } from "../services/Dictionary.ts"
import { Study } from "../services/Study.ts"

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
    const dictionary = yield* DictionaryRepo
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
            dictionary: { entries: yield* dictionary.count }
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
    return handlers.handleAll({
      search: ({ query }) => dictionary.search(query.q, Math.min(Math.max(query.limit ?? 30, 1), 100)),
      english: ({ query }) => dictionary.english(query.term),
      entry: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) =>
          dictionary.entry(params.id, user.profile).pipe(Effect.flatMap(orNotFound("No such entry")))
        ),
      enrich: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) =>
          dictionary.requestEnrichment(params.id, user.profile).pipe(Effect.flatMap(orNotFound("No such entry")))
        )
    })
  })
)

const CoachHandlers = HttpApiBuilder.group(
  KotoriApi,
  "coach",
  Effect.fn(function* (handlers) {
    const coaching = yield* Coaching
    return handlers.handleAll({
      naturalness: ({ payload }) => Effect.flatMap(CurrentUser, (user) => coaching.naturalness(user.profile, payload)),
      howToSay: ({ payload }) => Effect.flatMap(CurrentUser, (user) => coaching.howToSay(user.profile, payload))
    })
  })
)

const AudioHandlers = HttpApiBuilder.group(
  KotoriApi,
  "audio",
  Effect.fn(function* (handlers) {
    const coaching = yield* Coaching
    return handlers.handleAll({
      speak: ({ payload }) => Effect.flatMap(CurrentUser, (user) => coaching.speak(user.profile, payload))
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
          if (!(yield* study.removeNote(user.profile, params.id))) {
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
