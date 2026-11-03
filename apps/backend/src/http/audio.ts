import { Effect, Option } from "effect"
import { Headers, HttpRouter, HttpServerResponse } from "effect/http"
import { AudioStore, isAudioKey } from "../features/audio/AudioStore.ts"

/** One inclusive byte span of a clip. */
export interface ByteSpan {
  readonly start: number
  readonly end: number
}

/**
 * A single `Range: bytes=` request against a clip of `size` bytes.
 *
 * `undefined` means "send the whole clip": no header, or a form this route
 * doesn't serve (a multipart range). `"unsatisfiable"` is a range that starts
 * past the end. Media elements on iOS, and AVPlayer in the native app, ask for
 * a range before they will play; answering that with the whole file as 200
 * makes the clip look unloadable.
 */
export const byteRange = (header: string | null | undefined, size: number): ByteSpan | "unsatisfiable" | undefined => {
  if (header == null) return undefined
  const spec = header.trim()
  if (spec === "") return undefined
  if (!spec.toLowerCase().startsWith("bytes=") || spec.includes(",")) return undefined
  const [startRaw = "", endRaw = ""] = spec.slice("bytes=".length).split("-")
  if (startRaw === "" && endRaw === "") return "unsatisfiable"
  if (size <= 0) return "unsatisfiable"
  if (startRaw === "") {
    const suffix = Number(endRaw)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable"
    const length = Math.min(suffix, size)
    return { start: size - length, end: size - 1 }
  }
  if (!/^\d+$/.test(startRaw) || (endRaw !== "" && !/^\d+$/.test(endRaw))) return "unsatisfiable"
  const start = Number(startRaw)
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable"
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1)
  if (!Number.isSafeInteger(end) || end < start) return "unsatisfiable"
  return { start, end }
}

const clipResponse = (body: Uint8Array, range: ByteSpan | "unsatisfiable" | undefined) => {
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable"
  }
  if (range === undefined) {
    return HttpServerResponse.uint8Array(body, { contentType: "audio/mpeg", headers })
  }
  if (range === "unsatisfiable") {
    return HttpServerResponse.empty({
      status: 416,
      headers: { ...headers, "content-range": `bytes */${body.byteLength}` }
    })
  }
  // A copy, not a view: the player reads `content-length` bytes from the start of the buffer.
  const slice = body.slice(range.start, range.end + 1)
  return HttpServerResponse.uint8Array(slice, {
    status: 206,
    contentType: "audio/mpeg",
    headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${body.byteLength}` }
  })
}

/** Serves generated pronunciation clips. Keys are content hashes, so responses can be cached forever. */
export const AudioRoute = HttpRouter.add("GET", "/audio/:file", (request) =>
  Effect.gen(function* () {
    const { file = "" } = yield* HttpRouter.params
    const key = file.replace(/\.mp3$/, "")
    if (!isAudioKey(key)) return HttpServerResponse.empty({ status: 404 })
    const bytes = yield* (yield* AudioStore).read(key)
    const header = Headers.get(request.headers, "range")
    return Option.match(bytes, {
      onNone: () => HttpServerResponse.empty({ status: 404 }),
      onSome: (body) => clipResponse(body, byteRange(Option.getOrUndefined(header), body.byteLength))
    })
  })
)
