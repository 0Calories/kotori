import { TypeSafeError } from "@typesafe-ai/sdk"
import { ConfigProvider, Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Jev, type JevState } from "../src/index.ts"

const withConfig = (values: Record<string, string>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values)))

describe("Jev", () => {
  const questions = { ok: { type: "noul", instructions: "Is `word` a greeting?" } } as const

  it("sends non-null state and pinned model, and surfaces nullable usage tokens", async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const fetch = async (input: string, init?: RequestInit) => {
      requests.push({ url: input, body: typeof init?.body === "string" ? JSON.parse(init.body) : null })
      return Response.json({
        model: "jev-1.14.0",
        answers: { ok: { type: "noul", noul: 0.92 } },
        usage: { input_tokens: null, output_tokens: null }
      })
    }

    const result = await Effect.gen(function* () {
      const jev = yield* Jev.make({ fetch }).pipe(withConfig({ TYPESAFE_API_KEY: "test" }))
      return yield* jev.ask({ word: "こんにちは", note: null }, questions)
    }).pipe(Effect.runPromise)

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(requests[0]!.body).toEqual({
      state: { word: "こんにちは", note: null },
      questions,
      model: "jev-1.14.0"
    })
    expect(result.answers.ok.noul).toBe(0.92)
    expect(result.usage).toEqual({ input_tokens: null, output_tokens: null })
  })

  it("wraps client-side validation rejections from @typesafe-ai/sdk in JevError", async () => {
    const error = await Effect.gen(function* () {
      const jev = yield* Jev.make({
        fetch: () => Promise.reject(new Error("must not reach fetch"))
      }).pipe(withConfig({ TYPESAFE_API_KEY: "test" }))
      // @ts-expect-error top-level state cannot be null in @typesafe-ai/sdk 0.7
      const invalidState: JevState = null
      return yield* Effect.flip(jev.ask(invalidState, questions))
    }).pipe(Effect.runPromise)

    expect(error._tag).toBe("JevError")
    expect(error.cause).toBeInstanceOf(TypeSafeError)
  })

  it("reports configured: false and fails cleanly when TYPESAFE_API_KEY is unset", async () => {
    const { configured, error } = await Effect.gen(function* () {
      const jev = yield* Jev.make().pipe(withConfig({}))
      return {
        configured: jev.configured,
        error: yield* Effect.flip(jev.ask("state", questions))
      }
    }).pipe(Effect.runPromise)

    expect(configured).toBe(false)
    expect(error._tag).toBe("JevError")
    expect(error.message).toContain("TYPESAFE_API_KEY")
  })
})
