import { NodeHttpClient } from "@effect/platform-node"
import { audioFiles } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option } from "effect"
import { Database, type DatabaseShape } from "../../db/Database.ts"
import { Bucket } from "../../integrations/storage/Bucket.ts"

export const isAudioKey = (key: string) => /^[a-f0-9]{64}$/.test(key)

export const clipObject = (key: string) => `${key}.mp3`
export const CLIP_HEADERS = { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" }

const inTable = (db: DatabaseShape) => ({
  put: Effect.fn("AudioStore.put")(function* (key: string, bytes: Uint8Array) {
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    yield* db.insert(audioFiles).values({ key, data }).onConflictDoUpdate({ target: audioFiles.key, set: { data } })
  }, Effect.orDie),

  read: Effect.fn("AudioStore.read")(function* (key: string) {
    if (!isAudioKey(key)) return Option.none<Uint8Array>()
    const rows = yield* db.select({ data: audioFiles.data }).from(audioFiles).where(eq(audioFiles.key, key))
    return Option.fromNullishOr(rows[0]?.data).pipe(Option.map((data) => new Uint8Array(data)))
  }, Effect.orDie),

  exists: Effect.fn("AudioStore.exists")(function* (key: string) {
    if (!isAudioKey(key)) return false
    return (yield* db.$count(audioFiles, eq(audioFiles.key, key))) > 0
  }, Effect.orDie)
})

export class AudioStore extends Context.Service<
  AudioStore,
  {
    put(key: string, bytes: Uint8Array): Effect.Effect<void>
    read(key: string): Effect.Effect<Option.Option<Uint8Array>>
    exists(key: string): Effect.Effect<boolean>
  }
>()("@kotori/backend/AudioStore") {
  static readonly database = Layer.effect(
    AudioStore,
    Effect.gen(function* () {
      return AudioStore.of(inTable(yield* Database))
    })
  )

  static readonly bucket = Layer.effect(
    AudioStore,
    Effect.gen(function* () {
      const bucket = yield* Bucket
      const table = inTable(yield* Database)

      const put = Effect.fn("AudioStore.put")(function* (key: string, bytes: Uint8Array) {
        yield* bucket.put(clipObject(key), bytes, CLIP_HEADERS)
      }, Effect.orDie)

      const read = Effect.fn("AudioStore.read")(function* (key: string) {
        if (!isAudioKey(key)) return Option.none<Uint8Array>()
        // Fall back to audio_files for unmigrated clips or transient bucket errors.
        const stored = yield* bucket
          .get(clipObject(key))
          .pipe(
            Effect.catchTag("BucketError", (error) =>
              Effect.logWarning("Reading a clip from the bucket failed", error.message).pipe(Effect.as(Option.none()))
            )
          )
        return Option.isSome(stored) ? stored : yield* table.read(key)
      }, Effect.orDie)

      const exists = Effect.fn("AudioStore.exists")(function* (key: string) {
        if (!isAudioKey(key)) return false
        // Propagate bucket.head errors rather than returning false, which would cause Speech to re-synthesize an existing clip.
        return Option.isSome(yield* bucket.head(clipObject(key))) || (yield* table.exists(key))
      }, Effect.orDie)

      return AudioStore.of({ put, read, exists })
    })
  )

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const name = yield* Config.option(Config.String("KOTORI_AUDIO_BUCKET"))
      return Option.match(name, {
        onNone: () => AudioStore.database,
        onSome: (name) =>
          AudioStore.bucket.pipe(Layer.provide(Bucket.layer(name)), Layer.provide(NodeHttpClient.layerUndici))
      })
    })
  )
}
