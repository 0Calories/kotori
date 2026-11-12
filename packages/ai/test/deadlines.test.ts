import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Fiber, Layer, Schema } from "effect"
import { HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Claude, ClaudeDeadline, ElevenLabs, Jev, JevDeadline } from "../src/index.ts"

// Every provider call has a deadline over the whole call, the SDK's retries included. These run
// the real provider code over a transport that never answers, on the test clock: nothing sleeps
// and nothing reaches the network.

/** A `fetch` that never answers, and records each request and whether it was aborted. */
const hangingFetch = () => {
  const requests: Array<{ aborted: () => boolean }> = []
  let started: () => void = () => {}
  const firstRequest = new Promise<void>((resolve) => (started = resolve))
  const fetch = (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      const signal = init?.signal
      requests.push({ aborted: () => signal?.aborted === true })
      started()
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    })
  return { fetch, requests, firstRequest: Effect.promise(() => firstRequest) }
}

const withConfig = (values: Record<string, string>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values)))

const generateOptions = { schema: Schema.Struct({ ok: Schema.Boolean }), system: "test", prompt: "test" }

describe("Claude.generate", () => {
  it.effect("fails as timed_out once the interactive deadline passes, and aborts the request", () =>
    Effect.gen(function* () {
      const transport = hangingFetch()
      const claude = yield* Claude.make({ apiKey: "test", fetch: transport.fetch })
      const fiber = yield* Effect.forkChild(Effect.flip(claude.generate(generateOptions)))
      yield* transport.firstRequest

      yield* TestClock.adjust(ClaudeDeadline.interactive)
      const error = yield* Fiber.join(fiber)
      assert.strictEqual(error.reason, "timed_out")
      assert.lengthOf(transport.requests, 1)
      assert.isTrue(transport.requests[0]!.aborted())
    })
  )

  it.effect("gives a bulk call its longer deadline", () =>
    Effect.gen(function* () {
      const transport = hangingFetch()
      const claude = yield* Claude.make({ apiKey: "test", fetch: transport.fetch })
      const fiber = yield* Effect.forkChild(
        Effect.flip(claude.generate({ ...generateOptions, timeout: ClaudeDeadline.bulk }))
      )
      yield* transport.firstRequest

      yield* TestClock.adjust(ClaudeDeadline.interactive)
      // Still waiting.
      assert.isUndefined(fiber.pollUnsafe())
      yield* TestClock.adjust(ClaudeDeadline.bulk)
      assert.strictEqual((yield* Fiber.join(fiber)).reason, "timed_out")
      assert.isTrue(transport.requests[0]!.aborted())
    })
  )
})

describe("Jev.ask", () => {
  const questions = { ok: { type: "noul", instructions: "Is this a test?" } } as const

  it.effect("fails with a JevError once its deadline passes, and aborts the request", () =>
    Effect.gen(function* () {
      const transport = hangingFetch()
      const jev = yield* Jev.make({ fetch: transport.fetch }).pipe(withConfig({ TYPESAFE_API_KEY: "test" }))
      const interactive = yield* Effect.forkChild(Effect.flip(jev.ask("state", questions)))
      const bulk = yield* Effect.forkChild(Effect.flip(jev.ask("state", questions, { timeout: JevDeadline.bulk })))
      yield* transport.firstRequest

      yield* TestClock.adjust(JevDeadline.interactive)
      const error = yield* Fiber.join(interactive)
      assert.strictEqual(error._tag, "JevError")
      assert.include(error.message, "didn't answer")
      assert.isUndefined(bulk.pollUnsafe())

      yield* TestClock.adjust(JevDeadline.bulk)
      assert.strictEqual((yield* Fiber.join(bulk))._tag, "JevError")
      assert.isTrue(transport.requests.every((request) => request.aborted()))
    })
  )
})

describe("ElevenLabs.synthesize", () => {
  it.effect("retries an attempt that hangs past 30 s, and fails as timed_out after 90 s", () =>
    Effect.gen(function* () {
      const signals: Array<AbortSignal> = []
      const hanging = HttpClient.make((_request, _url, signal) => {
        signals.push(signal)
        return Effect.never
      })
      const tts = yield* Effect.flatMap(ElevenLabs, Effect.succeed).pipe(
        Effect.provide(ElevenLabs.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, hanging)))),
        withConfig({ ELEVENLABS_API_KEY: "test" })
      )
      const fiber = yield* Effect.forkChild(Effect.flip(tts.synthesize("テスト", "ja", "voice")))

      yield* TestClock.adjust("31 seconds")
      // The first attempt timed out and was aborted; the retry is under way.
      assert.lengthOf(signals, 2)
      assert.isTrue(signals[0]!.aborted)

      yield* TestClock.adjust("60 seconds")
      const error = yield* Fiber.join(fiber)
      assert.strictEqual(error.reason, "timed_out")
      assert.lengthOf(signals, 3)
      assert.isTrue(signals.every((signal) => signal.aborted))
    })
  )
})
