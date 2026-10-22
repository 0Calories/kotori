import { EnrichmentRepo } from "@kotori/db"
import { Context, Effect, Layer, Option } from "effect"

/** Audio keys are sha256 hex digests, which also makes them safe to use in paths and URLs. */
export const isAudioKey = (key: string) => /^[a-f0-9]{64}$/.test(key)

/**
 * Where pronunciation clips live. This layer keeps the MP3 bytes in Postgres
 * (`audio_clips`), which at beta volume is a few megabytes a month and needs no
 * extra service; swap the layer for object storage when that changes.
 */
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
      const repo = yield* EnrichmentRepo
      return AudioStore.of({
        put: (key, bytes) => repo.putAudioClip(key, bytes),
        read: (key) => (isAudioKey(key) ? repo.audioClip(key) : Effect.succeed(Option.none())),
        exists: (key) => (isAudioKey(key) ? repo.hasAudioClip(key) : Effect.succeed(false))
      })
    })
  )
}
