import type { Question, Questions } from "@typesafe-ai/sdk"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { CASTING_BATCH, Jev, JevError, judgeCasting } from "../src/index.ts"

type Probabilities = Readonly<Record<string, number>>

/** What the fake answers, per question name without its sentence prefix (`formality`, `gender`…). */
type Script = Readonly<Record<string, Probabilities>>

const sure: Script = {
  formality: { "0": 0, "1": 0.8, "2": 0.1, "3": 0.1, "4": 0 },
  gender: { masculine: 0.85, feminine: 0.05, unspecified: 0.1 },
  age: { youth: 0.7, adult: 0.2, unspecified: 0.1 },
  medium: { conversation: 0.9, announcement: 0.05, narration: 0.05 },
  tone: { cheerful: 0.7, neutral: 0.3 }
}

const top = (probabilities: Probabilities) =>
  Object.entries(probabilities).reduce((best, next) => (next[1] > best[1] ? next : best))

/** A Jev that answers every question from `script`, by its sentence (`文N。` is N) and kind, and records each request. */
const fakeJev = (script: (sentence: number) => Script = () => sure) => {
  const asked: Array<{ state: unknown; questions: Questions }> = []
  const jev = Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state, questions) =>
      Effect.sync(() => {
        asked.push({ state, questions })
        const answers = Object.fromEntries(
          Object.entries(questions).map(([name, question]: [string, Question]) => {
            const [, kind] = /^s\d+_(\w+)$/u.exec(name)!
            const { sentence } = question.instructions as { sentence: string }
            const probabilities = script(Number(/\d+/u.exec(sentence)![0]))[kind!]!
            const [choice, probability] = top(probabilities)
            return [
              name,
              question.type === "score"
                ? { type: "score", score: Number(choice), confidence: probability, legend: {}, probabilities }
                : { type: "choice", choice, confidence: probability, probabilities }
            ]
          })
        )
        return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 0 } } as never
      })
  })
  return { jev, asked }
}

const sentences = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ sentence: `文${index}。`, translation: `Sentence ${index}.` }))

describe("judgeCasting", () => {
  it("asks about all of an entry's sentences in one request, each question carrying its sentence", async () => {
    const { asked, jev } = fakeJev()
    const judged = await Effect.runPromise(judgeCasting(jev, "ja", sentences(3)))
    expect(judged).toHaveLength(3)
    expect(asked).toHaveLength(1)
    const { questions } = asked[0]!
    expect(Object.keys(questions)).toHaveLength(3 * 5)
    expect(questions["s0_formality"]?.type).toBe("score")
    for (const kind of ["gender", "age", "medium", "tone"]) expect(questions[`s2_${kind}`]?.type).toBe("choice")
    // The sentence and its translation travel with each question, not in the shared state.
    expect(questions["s2_gender"]?.instructions).toMatchObject({ sentence: "文2。", translation: "Sentence 2." })
    expect(JSON.stringify(asked[0]!.state)).not.toContain("文")
  })

  it("splits a long list into requests of at most CASTING_BATCH sentences, keeping the order", async () => {
    const { asked, jev } = fakeJev((index) => ({
      ...sure,
      formality: index < CASTING_BATCH ? sure["formality"]! : { "4": 0.9, "3": 0.1 }
    }))
    const judged = await Effect.runPromise(judgeCasting(jev, "ja", sentences(CASTING_BATCH + 2)))
    expect(asked.map((request) => Object.keys(request.questions).length)).toEqual([CASTING_BATCH * 5, 2 * 5])
    expect(judged.map((one) => one?.formality)).toEqual([
      ...Array.from({ length: CASTING_BATCH }, () => "casual"),
      "formal",
      "formal"
    ])
  })

  it("asks nothing for no sentences", async () => {
    const { asked, jev } = fakeJev()
    expect(await Effect.runPromise(judgeCasting(jev, "en", []))).toEqual([])
    expect(asked).toHaveLength(0)
  })

  it("takes the most probable register, not the expected score between two", async () => {
    // Casual or polite, never neutral: averaging the two would cast a register nobody judged.
    const { jev } = fakeJev(() => ({ ...sure, formality: { "1": 0.45, "2": 0.1, "3": 0.45 - 0.01 } }))
    const [judged] = await Effect.runPromise(judgeCasting(jev, "ja", sentences(1)))
    expect(judged?.formality).toBe("casual")
  })

  it("keeps sure speaker signals and drops unsure ones to unspecified or null", async () => {
    const { jev } = fakeJev((index) =>
      index === 0
        ? { ...sure, tone: { humorous: 0.8, neutral: 0.2 } }
        : {
            formality: { "2": 0.6, "3": 0.4 },
            gender: { feminine: 0.5, masculine: 0.3, unspecified: 0.2 },
            age: { child: 0.4, unspecified: 0.35, adult: 0.25 },
            medium: { narration: 0.45, conversation: 0.4, announcement: 0.15 },
            tone: { humorous: 0.5, neutral: 0.5 - 0.01 }
          }
    )
    const judged = await Effect.runPromise(judgeCasting(jev, "ja", sentences(2)))
    expect(judged).toEqual([
      {
        formality: "casual",
        casting: {
          speakerGender: "masculine",
          speakerAge: "youth",
          medium: "conversation",
          variety: null,
          tone: "humorous"
        }
      },
      {
        formality: "neutral",
        // A wrong gender or a child's voice is the most audible miscast: only a sure call steers casting.
        casting: { speakerGender: "unspecified", speakerAge: "unspecified", medium: null, variety: null, tone: null }
      }
    ])
  })

  it("leaves a sentence unjudged when its formality answer is missing or malformed, and judges the rest", async () => {
    const { jev: full } = fakeJev()
    // Sentence 1's formality is left out and sentence 2's has no usable level; sentence 0 is answered.
    const jev = Jev.of({
      ...full,
      ask: (state, questions) =>
        full.ask(state, questions).pipe(
          Effect.map((result) => {
            const { s1_formality: _, ...answers } = result.answers as Record<string, unknown>
            const malformed = { type: "score", score: Number.NaN, confidence: 0, legend: {}, probabilities: {} }
            return { ...result, answers: { ...answers, s2_formality: malformed } } as never
          })
        )
    })
    const judged = await Effect.runPromise(judgeCasting(jev, "ja", sentences(3)))
    expect(judged.map((one) => one?.formality ?? null)).toEqual(["casual", null, null])
    expect(judged[0]?.casting.speakerGender).toBe("masculine")
  })

  it("passes Jev's errors through, so the sentences stay unjudged and unvoiced", async () => {
    const jev = Jev.of({
      configured: true,
      model: "jev-test",
      ask: () => Effect.fail(new JevError({ message: "boom" }))
    })
    const exit = await Effect.runPromiseExit(judgeCasting(jev, "ja", sentences(2)))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
