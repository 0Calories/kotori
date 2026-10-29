import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Claude, describeRequest, ExamplesOutput, ExampleWriter } from "../src/index.ts"
import type { ExampleRequest } from "../src/index.ts"
import { examplesSystem } from "../src/prompts.ts"

const request: ExampleRequest = {
  headword: "あかん",
  reading: "あかん",
  otherForms: [],
  perSense: 2,
  senses: [
    {
      index: 0,
      glosses: ["useless", "no good"],
      partsOfSpeech: ["expression"],
      notes: ["colloquial"],
      dialects: ["Kansai-ben"]
    },
    { index: 1, glosses: ["must not"], partsOfSpeech: ["expression"], notes: [], dialects: [] }
  ]
}

const written = (overrides: Partial<(typeof ExamplesOutput.Type)["senses"][number]["examples"][number]> = {}) => ({
  ja: "それはあかんで",
  furigana: "それはあかんで",
  en: "That's no good.",
  formality: "casual" as const,
  speaker: { gender: "masculine" as const, age: "adult" as const },
  medium: "conversation" as const,
  variety: "Kansai-ben",
  tone: "rough" as const,
  note: null,
  noteJa: null,
  ...overrides
})

/** A Claude that returns a fixed structured answer and records what it was asked. */
const fakeClaude = (output: typeof ExamplesOutput.Type) => {
  const asked: Array<{ system: string; prompt: string }> = []
  const layer = Layer.succeed(
    Claude,
    Claude.of({
      model: "fake",
      available: Effect.succeed(true),
      generate: (options) =>
        Effect.sync(() => {
          asked.push({ system: options.system, prompt: options.prompt })
          return output as never
        })
    })
  )
  return { asked, layer }
}

const write = (output: typeof ExamplesOutput.Type) => {
  const claude = fakeClaude(output)
  return Effect.flatMap(ExampleWriter, (writer) => writer.write(request))
    .pipe(Effect.provide(ExampleWriter.layer.pipe(Layer.provide(claude.layer))), Effect.runPromise)
    .then((examples) => ({ examples, asked: claude.asked }))
}

describe("examples prompt", () => {
  it("asks for the casting signals and the dialect rule", () => {
    for (const field of ['"speaker"', '"medium"', '"variety"', '"tone"', '"formality"']) {
      expect(examplesSystem).toContain(field)
    }
    expect(examplesSystem).toMatch(/written entirely in that dialect/)
  })

  it("tells the writer which senses are dialect and keeps other notes separate", () => {
    const prompt = describeRequest(request)
    expect(prompt).toContain("dialect: Kansai-ben (write every sentence in it)")
    expect(prompt).toContain("notes: colloquial")
    expect(prompt.split("dialect:").length).toBe(2)
  })
})

describe("ExampleWriter.write", () => {
  it("flattens the speaker and normalises the variety label", async () => {
    const { examples } = await write({ senses: [{ sense: 0, examples: [written()] }] })
    expect(examples).toHaveLength(1)
    expect(examples[0]).toMatchObject({
      sense: 0,
      formality: "casual",
      speakerGender: "masculine",
      speakerAge: "adult",
      medium: "conversation",
      variety: "kansai",
      tone: "rough"
    })
  })

  it.each([
    ["Kansai dialect", "kansai"],
    ["kansai", "kansai"],
    ["Tohoku-ben", "tohoku"],
    ["British English", "british"],
    ["standard", null],
    [null, null]
  ])("maps the variety label %j to %j", async (label, expected) => {
    const { examples } = await write({ senses: [{ sense: 1, examples: [written({ variety: label })] }] })
    expect(examples[0]?.variety).toBe(expected)
  })

  it("sends the system prompt and the described request", async () => {
    const { asked } = await write({ senses: [] })
    expect(asked[0]?.system).toBe(examplesSystem)
    expect(asked[0]?.prompt).toBe(describeRequest(request))
  })
})
