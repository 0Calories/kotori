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

export class PendingApproval extends Schema.TaggedError<PendingApproval>()(
  "PendingApproval",
  { message: Schema.String },
  { httpApiStatus: 403 }
) {}

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

export const AskRefusal = Schema.Literals(["not_askable", "wrong_language", "repetition", "keyboard", "in_dictionary"])
export type AskRefusal = typeof AskRefusal.Type

export class AskRefused extends Schema.TaggedError<AskRefused>()(
  "AskRefused",
  { reason: AskRefusal },
  { httpApiStatus: 400 }
) {}
