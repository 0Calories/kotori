import { resolveFromRoot } from "@kotori/db"
import { Config, Context, Effect, FileSystem, Layer, Option, Path } from "effect"

/** Audio keys are sha256 hex digests, which also makes them safe to use in paths and URLs. */
export const isAudioKey = (key: string) => /^[a-f0-9]{64}$/.test(key)

/** MP3 clips on disk under `KOTORI_AUDIO_DIR` (default `data/audio`), sharded by key prefix. */
export class AudioStore extends Context.Service<AudioStore, {
  put(key: string, bytes: Uint8Array): Effect.Effect<void>
  read(key: string): Effect.Effect<Option.Option<Uint8Array>>
  exists(key: string): Effect.Effect<boolean>
}>()("@kotori/tts/AudioStore") {
  static readonly layer = Layer.effect(
    AudioStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = resolveFromRoot(yield* Config.String("KOTORI_AUDIO_DIR").pipe(Config.withDefault("data/audio")))
      const file = (key: string) => path.join(directory, key.slice(0, 2), `${key}.mp3`)

      const put = Effect.fn("AudioStore.put")(function*(key: string, bytes: Uint8Array) {
        yield* fs.makeDirectory(path.dirname(file(key)), { recursive: true })
        yield* fs.writeFile(file(key), bytes)
      }, Effect.orDie)

      const exists = (key: string) =>
        isAudioKey(key) ? fs.exists(file(key)).pipe(Effect.orElseSucceed(() => false)) : Effect.succeed(false)

      const read = (key: string) =>
        isAudioKey(key)
          ? fs.readFile(file(key)).pipe(Effect.map(Option.some), Effect.orElseSucceed(() => Option.none()))
          : Effect.succeed(Option.none())

      return AudioStore.of({ put, read, exists })
    })
  )
}
