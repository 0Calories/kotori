import { Clock, Config, Context, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { createHash, createHmac } from "node:crypto"

// An S3-compatible bucket, at the endpoint, with the keys, of the standard AWS variables, so any
// provider's works: Neon Object Storage (`neon env pull` writes them), S3, R2, MinIO. Path-style
// requests signed with AWS Signature Version 4, the one form every provider takes. Three
// operations on single objects, so no SDK.

export class BucketError extends Schema.TaggedError<BucketError>()("BucketError", {
  message: Schema.String
}) {}

export interface BucketCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: Redacted.Redacted
  readonly region: string
}

/** What a stored object's metadata says: its size, and its entity tag (an MD5 of the bytes on most providers). */
export interface ObjectHead {
  readonly size: number
  readonly etag: string | null
}

export class Bucket extends Context.Service<
  Bucket,
  {
    readonly name: string
    put(
      key: string,
      bytes: Uint8Array,
      headers: { readonly contentType: string; readonly cacheControl?: string }
    ): Effect.Effect<void, BucketError>
    get(key: string): Effect.Effect<Option.Option<Uint8Array>, BucketError>
    head(key: string): Effect.Effect<Option.Option<ObjectHead>, BucketError>
  }
>()("@kotori/backend/Bucket") {
  /** The bucket `name` at `AWS_ENDPOINT_URL_S3`, signed with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`. */
  static readonly layer = (name: string) =>
    Layer.effect(
      Bucket,
      Effect.gen(function* () {
        const endpoint = new URL(yield* Config.String("AWS_ENDPOINT_URL_S3"))
        const credentials: BucketCredentials = {
          accessKeyId: yield* Config.String("AWS_ACCESS_KEY_ID"),
          secretAccessKey: yield* Config.Redacted("AWS_SECRET_ACCESS_KEY"),
          region: yield* Config.String("AWS_REGION")
        }
        const client = (yield* HttpClient.HttpClient).pipe(
          // 503 SlowDown is how Neon (and S3) ask a client to back off.
          HttpClient.retryTransient({ schedule: Schedule.exponential(250), times: 4 })
        )

        const send = (
          method: "GET" | "HEAD" | "PUT",
          key: string,
          body?: { readonly bytes: Uint8Array; readonly headers: Record<string, string> }
        ) =>
          Effect.gen(function* () {
            const url = objectUrl(endpoint, name, key)
            const now = new Date(yield* Clock.currentTimeMillis)
            const headers = signRequest(
              { method, url, headers: body?.headers ?? {}, payload: body?.bytes ?? new Uint8Array() },
              credentials,
              now
            )
            const request = HttpClientRequest.make(method)(url).pipe(HttpClientRequest.setHeaders(headers))
            return yield* client.execute(
              body === undefined
                ? request
                : HttpClientRequest.bodyUint8Array(request, body.bytes, headers["content-type"])
            )
          }).pipe(
            Effect.catchTag("HttpClientError", (error) =>
              Effect.fail(new BucketError({ message: `${method} ${name}/${key}: ${error.message}` }))
            )
          )

        const failed = (operation: string, key: string, response: HttpClientResponse.HttpClientResponse) =>
          response.text.pipe(
            Effect.orElseSucceed(() => ""),
            Effect.flatMap((detail) =>
              Effect.fail(
                new BucketError({ message: `${operation} ${name}/${key}: ${response.status} ${detail.slice(0, 300)}` })
              )
            )
          )

        const put = Effect.fn("Bucket.put")(function* (
          key: string,
          bytes: Uint8Array,
          headers: { readonly contentType: string; readonly cacheControl?: string }
        ) {
          const response = yield* send("PUT", key, {
            bytes,
            headers: {
              "content-type": headers.contentType,
              ...(headers.cacheControl === undefined ? {} : { "cache-control": headers.cacheControl })
            }
          })
          if (response.status >= 300) return yield* failed("PUT", key, response)
        })

        const get = Effect.fn("Bucket.get")(function* (key: string) {
          const response = yield* send("GET", key)
          if (response.status === 404) return Option.none<Uint8Array>()
          if (response.status >= 300) return yield* failed("GET", key, response)
          const body = yield* response.arrayBuffer.pipe(
            Effect.mapError((error) => new BucketError({ message: `GET ${name}/${key}: ${error.message}` }))
          )
          return Option.some(new Uint8Array(body))
        })

        const head = Effect.fn("Bucket.head")(function* (key: string) {
          const response = yield* send("HEAD", key)
          if (response.status === 404) return Option.none<ObjectHead>()
          if (response.status >= 300) return yield* failed("HEAD", key, response)
          return Option.some({
            size: Number(response.headers["content-length"] ?? -1),
            etag: response.headers["etag"]?.replace(/"/g, "") ?? null
          })
        })

        return Bucket.of({ name, put, get, head })
      })
    )
}

/** RFC 3986 percent-encoding, which Signature Version 4 requires of each path segment. */
const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

/** A path-style object URL: `<endpoint>/<bucket>/<key>`, below any path the endpoint has. */
export const objectUrl = (endpoint: URL, bucket: string, key: string) => {
  const base = endpoint.pathname.replace(/\/$/, "")
  const path = [bucket, ...key.split("/")].map(encodeSegment).join("/")
  return new URL(`${base}/${path}`, endpoint.origin)
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest()

/**
 * The headers that sign a request with AWS Signature Version 4: `x-amz-date`,
 * `x-amz-content-sha256` and `authorization`, with the request's own headers, all of which are
 * signed. `url`'s path must already be encoded (`objectUrl`); query strings aren't used here.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
export const signRequest = (
  request: {
    readonly method: string
    readonly url: URL
    readonly headers: Record<string, string>
    readonly payload: Uint8Array
  },
  credentials: BucketCredentials,
  now: Date
): Record<string, string> => {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${credentials.region}/s3/aws4_request`
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value.trim()])),
    host: request.url.host,
    "x-amz-content-sha256": sha256(request.payload),
    "x-amz-date": amzDate
  }
  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(";")
  const canonicalRequest = [
    request.method,
    request.url.pathname,
    "",
    ...names.map((name) => `${name}:${headers[name]}`),
    "",
    signedHeaders,
    headers["x-amz-content-sha256"]
  ].join("\n")
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n")
  const signingKey = ["s3", "aws4_request"].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(`AWS4${Redacted.value(credentials.secretAccessKey)}`, day), credentials.region)
  )
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex")
  const { host: _, ...sent } = headers
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}
