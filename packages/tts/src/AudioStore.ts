import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

/** Audio keys are sha256 hex digests, which also makes them safe to use in paths and URLs. */
export const isAudioKey = (key: string) => /^[a-f0-9]{64}$/.test(key)

const DataRow = Schema.Struct({ data: Schema.Uint8Array })
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(DataRow))

/** MP3 clips in the `audio_files` table, so the API and the worker share them without a disk. */
export class AudioStore extends Context.Service<
  AudioStore,
  {
    put(key: string, bytes: Uint8Array): Effect.Effect<void>
    read(key: string): Effect.Effect<Option.Option<Uint8Array>>
    exists(key: string): Effect.Effect<boolean>
  }
>()("@kotori/tts/AudioStore") {
  static readonly layer = Layer.effect(
    AudioStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const put = Effect.fn("AudioStore.put")(function* (key: string, bytes: Uint8Array) {
        yield* sql`
          INSERT INTO audio_files ${sql.insert({ key, data: bytes })}
          ON CONFLICT (key) DO UPDATE SET data = excluded.data
        `
      }, Effect.orDie)

      const read = Effect.fn("AudioStore.read")(function* (key: string) {
        if (!isAudioKey(key)) return Option.none<Uint8Array>()
        const rows = yield* sql`SELECT data FROM audio_files WHERE key = ${key}`.pipe(Effect.flatMap(decodeRows))
        return Option.fromNullishOr(rows[0]?.data)
      }, Effect.orDie)

      const exists = Effect.fn("AudioStore.exists")(function* (key: string) {
        if (!isAudioKey(key)) return false
        const rows = yield* sql`SELECT 1 AS one FROM audio_files WHERE key = ${key}`
        return rows.length > 0
      }, Effect.orDie)

      return AudioStore.of({ put, read, exists })
    })
  )
}
