import * as Schema from "effect/Schema"

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 }
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

/** The account exists but an admin hasn't approved it yet (or it was archived). Only `/account` endpoints work. */
export class PendingApproval extends Schema.TaggedError<PendingApproval>()(
  "PendingApproval",
  { message: Schema.String },
  { httpApiStatus: 403 }
) {}

/** Sign-in couldn't be checked because Managed Auth is unreachable; the credentials may well be fine. */
export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable>()(
  "AuthUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

/** An AI provider is not configured, or failed in a way retrying won't immediately fix. */
export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()(
  "AiUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  { message: Schema.String, retryAfterSeconds: Schema.Int },
  { httpApiStatus: 429 }
) {}

/**
 * Why Ask Kotori turned a query away without asking anyone: not something to look up
 * (`not_askable`: too long, markup, numbers, an unexpected script), written in the learner's own
 * language rather than the one learned, a key held down, a run along the keyboard, or already
 * answered by the dictionary's results. A code, not copy: the app words each in the learner's language.
 */
export const AskRefusal = Schema.Literals(["not_askable", "wrong_language", "repetition", "keyboard", "in_dictionary"])
export type AskRefusal = typeof AskRefusal.Type

export class AskRefused extends Schema.TaggedError<AskRefused>()(
  "AskRefused",
  { reason: AskRefusal },
  { httpApiStatus: 400 }
) {}
