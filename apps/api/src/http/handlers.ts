import { CurrentUser, InvalidRequest, KotoriApi, NotFound } from "@kotori/domain"
import { Accounts, Coaching, Dictionary, Study, System } from "@kotori/services"
import { Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { withServices } from "./services.ts"

const VERSION = "0.1.0"

const orNotFound =
  <A>(message: string) =>
  (option: Option.Option<A>) =>
    Option.match(option, { onNone: () => Effect.fail(new NotFound({ message })), onSome: Effect.succeed })

const SystemHandlers = HttpApiBuilder.group(
  KotoriApi,
  "system",
  Effect.fn(function* (handlers) {
    const run = yield* withServices
    return handlers.handleAll({
      health: () => run(Effect.map(System.status, (status) => ({ ok: true, version: VERSION, ...status })))
    })
  })
)

const AccountHandlers = HttpApiBuilder.group(
  KotoriApi,
  "account",
  Effect.fn(function* (handlers) {
    const run = yield* withServices
    return handlers.handleAll({
      me: () => Effect.map(CurrentUser, (user) => user.profile),
      update: ({ payload }) => Effect.flatMap(CurrentUser, (user) => run(Accounts.update(user.profile, payload))),
      delete: () => Effect.flatMap(CurrentUser, (user) => run(Accounts.remove(user.id)))
    })
  })
)

const DictionaryHandlers = HttpApiBuilder.group(
  KotoriApi,
  "dictionary",
  Effect.fn(function* (handlers) {
    const run = yield* withServices
    return handlers.handleAll({
      search: ({ query }) => run(Dictionary.search(query.q, Math.min(Math.max(query.limit ?? 30, 1), 100))),
      entry: ({ params }) => run(Dictionary.entry(params.id)).pipe(Effect.flatMap(orNotFound("No such entry"))),
      enrich: ({ params }) =>
        run(Dictionary.requestEnrichment(params.id)).pipe(Effect.flatMap(orNotFound("No such entry")))
    })
  })
)

const CoachHandlers = HttpApiBuilder.group(
  KotoriApi,
  "coach",
  Effect.fn(function* (handlers) {
    const run = yield* withServices
    return handlers.handleAll({
      naturalness: ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => run(Coaching.naturalness(user.profile, payload))),
      howToSay: ({ payload }) => Effect.flatMap(CurrentUser, (user) => run(Coaching.howToSay(user.profile, payload)))
    })
  })
)

const AudioHandlers = HttpApiBuilder.group(
  KotoriApi,
  "audio",
  Effect.fn(function* (handlers) {
    const run = yield* withServices
    return handlers.handleAll({
      speak: ({ payload }) => Effect.flatMap(CurrentUser, (user) => run(Coaching.speak(user.profile, payload)))
    })
  })
)

const StudyHandlers = HttpApiBuilder.group(
  KotoriApi,
  "study",
  Effect.fn(function* (handlers) {
    const run = yield* withServices
    return handlers.handleAll({
      notes: () => Effect.flatMap(CurrentUser, (user) => run(Study.notes(user.profile))),
      addNote: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          if (payload.content.kind === "phrase" && payload.content.text.trim().length === 0) {
            return yield* new InvalidRequest({ message: "A phrase needs some text" })
          }
          return yield* run(Study.addNote(user.profile, payload))
        }),
      removeNote: ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          if (!(yield* run(Study.removeNote(user.profile, params.id)))) {
            return yield* new NotFound({ message: "No such note" })
          }
        }),
      queue: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) =>
          run(Study.queue(user.profile, Math.min(Math.max(query.limit ?? 50, 1), 200)))
        ),
      answer: ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const result = yield* run(Study.answer(user.profile, params.id, payload.rating, payload.durationMs))
          return yield* orNotFound<typeof result extends Option.Option<infer A> ? A : never>("No such card")(result)
        }),
      stats: () => Effect.flatMap(CurrentUser, (user) => run(Study.stats(user.profile)))
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
