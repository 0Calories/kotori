import { Claude, Jev, Pronouncer } from "@kotori/ai"
import { CurrentUser, KotoriApi, NotFound } from "@kotori/contracts"
import { Effect, Layer, Match, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Database } from "../db/Database.ts"
import { Accounts } from "../features/accounts/Accounts.ts"
import { Asks } from "../features/asks/Asks.ts"
import { Coaching } from "../features/coaching/Coaching.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { entryCount } from "../features/dictionary/index.ts"
import { Notebook } from "../features/notebook/Notebook.ts"
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
              formality: jev.configured,
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
    const asksService = yield* Asks
    return handlers.handleAll({
      search: ({ query }) =>
        Effect.flatMap(CurrentUser, (user) =>
          dictionary.search(query.q, user.profile.targetLanguage, Math.min(Math.max(query.limit ?? 30, 1), 100))
        ),
      entry: ({ params }) => dictionary.entry(params.id).pipe(Effect.flatMap(orNotFound("No such entry"))),
      enrichment: ({ params }) => dictionary.enrichment(params.id).pipe(Effect.flatMap(orNotFound("No such entry"))),
      enrich: ({ params }) =>
        Effect.flatMap(CurrentUser, (user) =>
          dictionary.requestEnrichment(params.id, user.profile.id).pipe(Effect.flatMap(orNotFound("No such entry")))
        ),
      ask: ({ payload }) => Effect.flatMap(CurrentUser, (user) => asksService.ask(user.profile, payload.q)),
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

const NotebookHandlers = HttpApiBuilder.group(
  KotoriApi,
  "notebook",
  Effect.fn(function* (handlers) {
    const notebook = yield* Notebook
    return handlers.handleAll({
      notes: () => Effect.flatMap(CurrentUser, (user) => notebook.notes(user.profile)),
      addNote: ({ payload }) => Effect.flatMap(CurrentUser, (user) => notebook.addNote(user.profile, payload)),
      removeNote: ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* Match.value(yield* notebook.removeNote(user.profile, params.id)).pipe(
            Match.when("deleted", () => Effect.void),
            Match.when("absent", () => Effect.void),
            Match.when("forbidden", () => Effect.fail(new NotFound({ message: "No such note" }))),
            Match.exhaustive
          )
        })
    })
  })
)

export const AllHandlers = Layer.mergeAll(
  SystemHandlers,
  AccountHandlers,
  DictionaryHandlers,
  CoachHandlers,
  AudioHandlers,
  NotebookHandlers
)
