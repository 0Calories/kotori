import { assert, layer } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { ElevenLabs } from "../src/index.ts"

const requests: Array<{ url: string; key: string | undefined }> = []

/** ElevenLabs' API as far as these tests need it: quota errors for one phrase, MP3 bytes otherwise. */
const FakeApi = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request, url) =>
    Effect.sync(() => {
      requests.push({ url: url.toString(), key: request.headers["xi-api-key"] })
      const body = (request.body as { body: Uint8Array }).body
      const { text } = JSON.parse(new TextDecoder().decode(body)) as { text: string }
      return HttpClientResponse.fromWeb(
        request,
        text === "over budget"
          ? new Response("quota_exceeded", { status: 401 })
          : new Response(new TextEncoder().encode(`mp3:${text}`), { status: 200 })
      )
    })
  )
)

const withConfig = (config: Record<string, string>) =>
  ElevenLabs.layer.pipe(Layer.provide(FakeApi), Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))))

layer(withConfig({ ELEVENLABS_API_KEY: "key", KOTORI_VOICE_JA: "kyoko" }))("ElevenLabs", (it) => {
  it.effect("speaks text with the language's voice and returns the MP3 bytes", () =>
    Effect.gen(function* () {
      const tts = yield* ElevenLabs
      assert.isTrue(tts.configured)
      const bytes = yield* tts.synthesize("たべる", "ja")
      assert.strictEqual(new TextDecoder().decode(bytes), "mp3:たべる")
      assert.include(requests[0]?.url, "https://api.elevenlabs.io/v1/text-to-speech/kyoko")
      assert.strictEqual(requests[0]?.key, "key")
    })
  )

  it.effect("tells a used-up quota apart from other failures", () =>
    Effect.gen(function* () {
      const error = yield* (yield* ElevenLabs).synthesize("over budget", "en").pipe(Effect.flip)
      assert.strictEqual(error.reason, "quota")
    })
  )
})

layer(withConfig({}))("ElevenLabs without a key", (it) => {
  it.effect("reports itself unconfigured and synthesises nothing", () =>
    Effect.gen(function* () {
      const tts = yield* ElevenLabs
      assert.isFalse(tts.configured)
      assert.strictEqual((yield* tts.synthesize("たべる", "ja").pipe(Effect.flip)).reason, "unconfigured")
    })
  )
})
