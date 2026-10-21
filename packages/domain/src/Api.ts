import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity"
import * as OpenApi from "effect/http-api/OpenApi"
import { CreateAccountRequest, Profile, Session, UpdateProfileRequest, UserId } from "./Account.ts"
import { HowToSayRequest, HowToSayResult, NaturalnessRequest, NaturalnessResult } from "./Coach.ts"
import { Enrichment, Entry, EntryId, SearchResult } from "./Dictionary.ts"
import { SituationSearchResult } from "./Situations.ts"
import { AiUnavailable, InvalidRequest, NotFound, RateLimited, Unauthorized } from "./Errors.ts"
import { Language } from "./Language.ts"
import {
  AddNoteRequest,
  AnswerRequest,
  AnswerResult,
  CardId,
  Note,
  NoteId,
  ReviewQueue,
  StudyStats
} from "./Study.ts"

export class CurrentUser extends Context.Service<CurrentUser, {
  readonly id: UserId
  readonly profile: Profile
}>()("@kotori/domain/CurrentUser") {}

/** Bearer-token auth. Tokens are issued when an account is created on first launch. */
export class Authorization extends HttpApiMiddleware.Service<Authorization, {
  provides: CurrentUser
  requires: never
}>()("@kotori/domain/Authorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized
}) {}

export const Health = Schema.Struct({
  ok: Schema.Boolean,
  version: Schema.String,
  /** Which optional providers are configured on this server. */
  features: Schema.Struct({
    coach: Schema.Boolean,
    nuance: Schema.Boolean,
    audio: Schema.Boolean
  }),
  dictionary: Schema.Struct({ entries: Schema.Int })
})
export type Health = typeof Health.Type

export class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: Health })
) {}

export class AccountApi extends HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("me", "/me", { success: Profile }),
    HttpApiEndpoint.patch("update", "/me", { payload: UpdateProfileRequest, success: Profile })
  )
  .middleware(Authorization)
  // Creating an account is the one call that doesn't need a token.
  .add(HttpApiEndpoint.post("create", "/", { payload: CreateAccountRequest, success: Session }))
  .prefix("/account")
{}

export class DictionaryApi extends HttpApiGroup.make("dictionary")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: {
        q: Schema.String,
        limit: Schema.optional(Schema.Int)
      },
      success: SearchResult
    }),
    // Prototype. Disabled unless KOTORI_SITUATIONS=1, so the default search route is unchanged.
    HttpApiEndpoint.get("situations", "/situations", {
      query: {
        q: Schema.String,
        limit: Schema.optional(Schema.Int)
      },
      success: SituationSearchResult,
      error: NotFound
    }),
    HttpApiEndpoint.get("entry", "/entries/:id", {
      params: { id: EntryId },
      success: Entry,
      error: NotFound
    }),
    // Queue example sentences and audio for an entry that hasn't been enriched yet.
    HttpApiEndpoint.post("enrich", "/entries/:id/enrich", {
      params: { id: EntryId },
      success: Enrichment,
      error: NotFound
    })
  )
  .middleware(Authorization)
  .prefix("/dictionary")
{}

export class CoachApi extends HttpApiGroup.make("coach")
  .add(
    HttpApiEndpoint.post("naturalness", "/naturalness", {
      payload: NaturalnessRequest,
      success: NaturalnessResult,
      error: [AiUnavailable, RateLimited]
    }),
    HttpApiEndpoint.post("howToSay", "/how-to-say", {
      payload: HowToSayRequest,
      success: HowToSayResult,
      error: [AiUnavailable, RateLimited]
    })
  )
  .middleware(Authorization)
  .prefix("/coach")
{}

export class StudyApi extends HttpApiGroup.make("study")
  .add(
    HttpApiEndpoint.get("notes", "/notes", { success: Schema.Array(Note) }),
    HttpApiEndpoint.post("addNote", "/notes", {
      payload: AddNoteRequest,
      success: Note,
      error: InvalidRequest
    }),
    HttpApiEndpoint.delete("removeNote", "/notes/:id", {
      params: { id: NoteId },
      success: HttpApiSchema.NoContent,
      error: NotFound
    }),
    HttpApiEndpoint.get("queue", "/queue", {
      query: { limit: Schema.optional(Schema.Int) },
      success: ReviewQueue
    }),
    HttpApiEndpoint.post("answer", "/cards/:id/answer", {
      params: { id: CardId },
      payload: AnswerRequest,
      success: AnswerResult,
      error: NotFound
    }),
    HttpApiEndpoint.get("stats", "/stats", { success: StudyStats })
  )
  .middleware(Authorization)
  .prefix("/study")
{}

export const SpeakRequest = Schema.Struct({
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  language: Language
})
export type SpeakRequest = typeof SpeakRequest.Type

export const SpeakResult = Schema.Struct({ url: Schema.String })
export type SpeakResult = typeof SpeakResult.Type

export class AudioApi extends HttpApiGroup.make("audio")
  .add(
    // Speaks any short phrase (e.g. a coach suggestion). Clips are cached by content.
    HttpApiEndpoint.post("speak", "/speak", {
      payload: SpeakRequest,
      success: SpeakResult,
      error: [AiUnavailable, RateLimited]
    })
  )
  .middleware(Authorization)
  .prefix("/audio")
{}

export class KotoriApi extends HttpApi.make("kotori")
  .add(SystemApi)
  .add(AccountApi)
  .add(DictionaryApi)
  .add(CoachApi)
  .add(StudyApi)
  .add(AudioApi)
  .annotateMerge(OpenApi.annotations({
    title: "Kotori API",
    description: "Dictionary, coaching and spaced repetition for learners of Japanese and English."
  }))
{}
