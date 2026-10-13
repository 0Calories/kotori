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
