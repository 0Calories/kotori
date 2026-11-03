import { assert, describe, it, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { Database } from "../src/db/Database.ts"
import { AudioStore } from "../src/features/audio/AudioStore.ts"
import { saveAudio } from "../src/features/audio/queries.ts"
import { AudioRoute, byteRange } from "../src/http/audio.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

const KEY = "ab".repeat(32)
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

describe("byte ranges for a pronunciation clip", () => {
  it.effect("serves the whole file when the player doesn't ask for a range", () =>
    Effect.sync(() => {
      assert.strictEqual(byteRange(undefined, MP3.byteLength), undefined)
      assert.strictEqual(byteRange(null, MP3.byteLength), undefined)
      // Multipart ranges aren't how a player asks for the next chunk.
      assert.strictEqual(byteRange("bytes=0-1,2-3", MP3.byteLength), undefined)
    })
  )

  it.effect("answers the ranges media players send, and refuses one that starts past the end", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(byteRange("bytes=0-3", MP3.byteLength), { start: 0, end: 3 })
      assert.deepStrictEqual(byteRange("bytes=4-", MP3.byteLength), { start: 4, end: MP3.byteLength - 1 })
      assert.deepStrictEqual(byteRange("bytes=-4", MP3.byteLength), {
        start: MP3.byteLength - 4,
        end: MP3.byteLength - 1
      })
      assert.strictEqual(byteRange("bytes=100-200", MP3.byteLength), "unsatisfiable")
      assert.strictEqual(byteRange("bytes=5-2", MP3.byteLength), "unsatisfiable")
    })
  )
})

const TestLayer = AudioStore.layer.pipe(Layer.provideMerge(DatabaseMemory))

const get = (path: string, headers?: Record<string, string>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<AudioStore>()
    const request = new Request(`http://api.test${path}`, headers === undefined ? undefined : { headers })
    const response = yield* Effect.acquireUseRelease(
      Effect.sync(() => HttpRouter.toWebHandler(AudioRoute, { disableLogger: true })),
      ({ handler }) => Effect.promise(() => handler(request, context)),
      ({ dispose }) => Effect.promise(dispose)
    )
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      range: response.headers.get("content-range"),
      accept: response.headers.get("accept-ranges"),
      length: response.headers.get("content-length"),
      body: new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))
    }
  })

layer(TestLayer)("GET /audio/:file", (it) => {
  it.effect("plays a stored clip in full, and the slice a player asked for", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* saveAudio(db, {
        key: KEY,
        text: "ばくすい",
        language: "ja",
        voiceId: "voice",
        voice: "ja-kyoko",
        modelId: "test-model",
        characters: 4,
        bytes: MP3.byteLength,
        createdAt: new Date(0)
      })
      yield* (yield* AudioStore).put(KEY, MP3)

      const full = yield* get(`/audio/${KEY}.mp3`)
      assert.strictEqual(full.status, 200)
      assert.strictEqual(full.type, "audio/mpeg")
      assert.strictEqual(full.accept, "bytes")
      assert.deepStrictEqual(full.body, MP3)

      const slice = yield* get(`/audio/${KEY}.mp3`, { range: "bytes=0-3" })
      assert.strictEqual(slice.status, 206)
      assert.strictEqual(slice.range, `bytes 0-3/${MP3.byteLength}`)
      assert.strictEqual(slice.length, "4")
      assert.deepStrictEqual(slice.body, MP3.slice(0, 4))

      const missing = yield* get(`/audio/${"cd".repeat(32)}.mp3`, { range: "bytes=0-1" })
      assert.strictEqual(missing.status, 404)

      const pastTheEnd = yield* get(`/audio/${KEY}.mp3`, { range: "bytes=100-200" })
      assert.strictEqual(pastTheEnd.status, 416)
      assert.strictEqual(pastTheEnd.range, `bytes */${MP3.byteLength}`)
    })
  )
})
