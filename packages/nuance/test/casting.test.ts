import type { Questions } from "@typesafe-ai/sdk"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { CAST_CONFIDENCE_FLOOR, castVoice, Jev, JevError } from "../src/index.ts"

const candidates = [
  { id: "ja-casual-m", description: "An energetic young man talking with friends." },
  { id: "ja-casual-f", description: "A bright young woman chatting with friends." }
]

const fakeJev = (answer: Effect.Effect<{ choice: string; confidence: number }, JevError>) => {
  const asked: Array<{ state: unknown; questions: Questions }> = []
  const jev = Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state, questions) => {
      asked.push({ state, questions })
      return answer.pipe(
        Effect.map(
          ({ choice, confidence }) =>
            ({
              model: "jev-test",
              answers: { voice: { type: "choice", choice, confidence, probabilities: {} } },
              usage: { input_tokens: 10, output_tokens: 0 }
            }) as never
        )
      )
    }
  })
  return { jev, asked }
}

describe("castVoice", () => {
  it("asks one choice question with the sentence, meaning, and a criterion per candidate", async () => {
    const { asked, jev } = fakeJev(Effect.succeed({ choice: "ja-casual-f", confidence: 0.8 }))
    const vote = await Effect.runPromise(
      castVoice(jev, { sentence: "それ、まじやばいって！", meaning: "That's seriously crazy!", candidates })
    )
    expect(vote).toEqual({ voiceId: "ja-casual-f", confidence: 0.8 })
    expect(asked).toHaveLength(1)
    expect(asked[0]!.state).toEqual({ sentence: "それ、まじやばいって！", meaning: "That's seriously crazy!" })
    const question = asked[0]!.questions["voice"]
    expect(question?.type).toBe("choice")
    expect(Object.keys((question as { criteria: object }).criteria)).toEqual(["ja-casual-m", "ja-casual-f"])
  })

  it("passes Jev's errors through for the caller's fallback", async () => {
    const { jev } = fakeJev(Effect.fail(new JevError({ message: "boom" })))
    const exit = await Effect.runPromiseExit(castVoice(jev, { sentence: "x", meaning: "y", candidates }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("returns a lone candidate without asking Jev", async () => {
    const { asked, jev } = fakeJev(Effect.die(new Error("must not be called")))
    const vote = await Effect.runPromise(castVoice(jev, { sentence: "x", meaning: "y", candidates: [candidates[0]!] }))
    expect(vote).toEqual({ voiceId: "ja-casual-m", confidence: 1 })
    expect(asked).toHaveLength(0)
  })

  it("dies on an empty candidate list: the selector guarantees at least one", async () => {
    const { jev } = fakeJev(Effect.die(new Error("must not be called")))
    const exit = await Effect.runPromiseExit(castVoice(jev, { sentence: "x", meaning: "y", candidates: [] }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("exposes the confidence floor for the caller's logging", () => {
    expect(CAST_CONFIDENCE_FLOOR).toBeGreaterThan(0)
    expect(CAST_CONFIDENCE_FLOOR).toBeLessThan(1)
  })
})
