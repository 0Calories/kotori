import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as OpenApi from "effect/http-api/OpenApi"
import { Profile, UpdateProfileRequest, UserId } from "./Account.ts"
import { HowToSayRequest, HowToSayResult, NaturalnessRequest, NaturalnessResult } from "./Coach.ts"
import { AskRequest, Enrichment, Entry, EntryId, Proposal, SearchResult } from "./Dictionary.ts"
import {
  AiUnavailable,
  AskRefused,
  AuthUnavailable,
  InvalidRequest,
  NotFound,
  PendingApproval,
  RateLimited,
  Unauthorized
} from "./Errors.ts"
import { Language } from "./Language.ts"
import { AddNoteRequest, Note, NoteId } from "./Notebook.ts"

export class CurrentUser extends Context.Service<
  CurrentUser,
  {
    readonly id: UserId
    readonly profile: Profile
  }
>()("@kotori/contracts/CurrentUser") {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  {
    provides: CurrentUser
    requires: never
  }
>()("@kotori/contracts/Authorization", {
  requiredForClient: true,
  error: [Unauthorized, PendingApproval, AuthUnavailable]
}) {}

export const Health = Schema.Struct({
  ok: Schema.Boolean,
  version: Schema.String,
  features: Schema.Struct({
    coach: Schema.Boolean,
    formality: Schema.Boolean,
    audio: Schema.Boolean,
    email: Schema.Boolean
  }),
  dictionary: Schema.Struct({ entries: Schema.Int })
})
export type Health = typeof Health.Type

export class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: Health })
) {}

/** `Authorization` allows unapproved accounts only on `/account` so onboarding and approval status remain readable. */
export class AccountApi extends HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("me", "/me", { success: Profile }),
    HttpApiEndpoint.patch("update", "/me", { payload: UpdateProfileRequest, success: Profile }),
    HttpApiEndpoint.delete("delete", "/me")
  )
  .middleware(Authorization)
  .prefix("/account") {}

export class DictionaryApi extends HttpApiGroup.make("dictionary")
  .add(
    HttpApiEndpoint.get("search", "/search", {
      query: {
        q: Schema.String,
        limit: Schema.optional(Schema.Int)
      },
      success: SearchResult
    }),
    HttpApiEndpoint.get("entry", "/entries/:id", {
      params: { id: EntryId },
      success: Entry,
      error: NotFound
    }),
    HttpApiEndpoint.get("enrichment", "/entries/:id/enrichment", {
      params: { id: EntryId },
      success: Enrichment,
      error: NotFound
    }),
    HttpApiEndpoint.post("enrich", "/entries/:id/enrich", {
      params: { id: EntryId },
      success: Enrichment,
      error: [NotFound, RateLimited]
    }),
    HttpApiEndpoint.post("ask", "/ask", {
      payload: AskRequest,
      success: Proposal,
      error: [AskRefused, AiUnavailable, RateLimited]
    }),
    HttpApiEndpoint.get("asks", "/asks", { success: Schema.Array(Proposal) })
  )
  .middleware(Authorization)
  .prefix("/dictionary") {}

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
  .prefix("/coach") {}

export class NotebookApi extends HttpApiGroup.make("notebook")
  .add(
    HttpApiEndpoint.get("notes", "/notes", { success: Schema.Array(Note) }),
    HttpApiEndpoint.post("addNote", "/notes", {
      payload: AddNoteRequest,
      success: Note,
      error: [InvalidRequest, NotFound]
    }),
    HttpApiEndpoint.delete("removeNote", "/notes/:id", {
      params: { id: NoteId },
      success: HttpApiSchema.NoContent,
      error: NotFound
    })
  )
  .middleware(Authorization)
  .prefix("/notebook") {}

export const SpeakRequest = Schema.Struct({
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  language: Language
})
export type SpeakRequest = typeof SpeakRequest.Type

export const SpeakResult = Schema.Struct({ url: Schema.String })
export type SpeakResult = typeof SpeakResult.Type

export class AudioApi extends HttpApiGroup.make("audio")
  .add(
    HttpApiEndpoint.post("speak", "/speak", {
      payload: SpeakRequest,
      success: SpeakResult,
      error: [AiUnavailable, RateLimited]
    })
  )
  .middleware(Authorization)
  .prefix("/audio") {}

export class KotoriApi extends HttpApi.make("kotori")
  .add(SystemApi)
  .add(AccountApi)
  .add(DictionaryApi)
  .add(CoachApi)
  .add(NotebookApi)
  .add(AudioApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "Kotori API",
      description: "Dictionary, coaching and notebook for Japanese and English learners."
    })
  ) {}
