import { AudioStore, isAudioKey } from "@kotori/tts"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

/** Serves generated pronunciation clips. Keys are content hashes, so responses can be cached forever. */
export const AudioRoute = HttpRouter.add(
  "GET",
  "/audio/:file",
  Effect.gen(function* () {
    const { file = "" } = yield* HttpRouter.params
    const key = file.replace(/\.mp3$/, "")
    if (!isAudioKey(key)) return HttpServerResponse.empty({ status: 404 })
    const bytes = yield* (yield* AudioStore).read(key)
    return Option.match(bytes, {
      onNone: () => HttpServerResponse.empty({ status: 404 }),
      onSome: (body) =>
        HttpServerResponse.uint8Array(body, {
          contentType: "audio/mpeg",
          headers: { "cache-control": "public, max-age=31536000, immutable" }
        })
    })
  })
)
