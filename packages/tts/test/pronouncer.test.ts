import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { DatabaseMemory, Repositories } from "@kotori/db"
import { ConfigProvider, Effect, Layer } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AudioStore, ElevenLabs, isAudioKey, Pronouncer } from "../src/index.ts"

const calls: Array<string> = []

const FakeElevenLabs = Layer.succeed(
  ElevenLabs,
  ElevenLabs.of({
    configured: true,
    model: "test-model",
    voiceFor: (language) => `voice-${language}`,
    synthesize: (text) =>
      Effect.sync(() => {
        calls.push(text)
        return new TextEncoder().encode(`mp3:${text}`)
      })
  })
)

const Config = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    KOTORI_AUDIO_DIR: mkdtempSync(join(tmpdir(), "kotori-audio-")),
    KOTORI_AUDIO_MONTHLY_CHARS: "10"
  })
)

const TestLayer = Pronouncer.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Repositories, FakeElevenLabs, AudioStore.layer)),
  Layer.provideMerge(DatabaseMemory),
  Layer.provide(NodeServices.layer),
  Layer.provide(Config)
)

layer(TestLayer)("Pronouncer", (it) => {
  it.effect("synthesises each clip once and serves it from the store afterwards", () =>
    Effect.gen(function* () {
      const pronouncer = yield* Pronouncer
      const key = yield* pronouncer.speak("たべる", "ja")
      assert.isTrue(isAudioKey(key))
      assert.strictEqual(yield* pronouncer.speak(" たべる ", "ja"), key)
      assert.deepStrictEqual(calls, ["たべる"])

      const bytes = yield* (yield* AudioStore).read(key)
      assert.strictEqual(
        new TextDecoder().decode(bytes.pipe((o) => (o._tag === "Some" ? o.value : new Uint8Array()))),
        "mp3:たべる"
      )
    })
  )

  it.effect("refuses to exceed the monthly character budget", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Pronouncer).speak("これはとても長い文章です", "ja").pipe(Effect.flip)
      assert.strictEqual(error.reason, "quota")
    })
  )
})
