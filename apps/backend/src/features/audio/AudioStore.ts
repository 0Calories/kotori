import { Database, schema } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"

/** Audio keys are sha256 hex digests, which also makes them safe to use in paths and URLs. */
export const isAudioKey = (key: string) => /^[a-f0-9]{64}$/.test(key)

/** MP3 clips in the `audio_files` table, so the API and the worker share them without a disk. */
export class AudioStore extends Context.Service<
  AudioStore,
  {
    /** Stores the bytes of a clip whose row `EnrichmentRepo.saveAudio` has already written. */
    put(key: string, bytes: Uint8Array): Effect.Effect<void>
    read(key: string): Effect.Effect<Option.Option<Uint8Array>>
    exists(key: string): Effect.Effect<boolean>
  }
>()("@kotori/tts/AudioStore") {
  static readonly layer = Layer.effect(
    AudioStore,
    Effect.gen(function* () {
      const db = yield* Database
      const { audioFiles } = schema

      const put = Effect.fn("AudioStore.put")(function* (key: string, bytes: Uint8Array) {
        // `bytea` travels as a Buffer; the view shares the bytes without copying them.
        const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        yield* db.insert(audioFiles).values({ key, data }).onConflictDoUpdate({ target: audioFiles.key, set: { data } })
      }, Effect.orDie)

      const read = Effect.fn("AudioStore.read")(function* (key: string) {
        if (!isAudioKey(key)) return Option.none<Uint8Array>()
        const rows = yield* db.select({ data: audioFiles.data }).from(audioFiles).where(eq(audioFiles.key, key))
        return Option.fromNullishOr(rows[0]?.data).pipe(Option.map((data) => new Uint8Array(data)))
      }, Effect.orDie)

      const exists = Effect.fn("AudioStore.exists")(function* (key: string) {
        if (!isAudioKey(key)) return false
        return (yield* db.$count(audioFiles, eq(audioFiles.key, key))) > 0
      }, Effect.orDie)

      return AudioStore.of({ put, read, exists })
    })
  )
}
