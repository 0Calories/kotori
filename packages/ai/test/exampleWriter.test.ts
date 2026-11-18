import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { englishExamplesSystem, examplesSystem } from "../src/examples/prompts.ts"
import { Claude, describeRequest, ExamplesOutput, ExampleWriter } from "../src/index.ts"
import type { ExampleRequest } from "../src/index.ts"

const request: ExampleRequest = {
  language: "ja",
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
  gloss: "useless",
  ja: "それはあかんで",
  furigana: "それはあかんで",
  en: "That's no good.",
  formality: "casual" as const,
  speaker: { gender: "masculine" as const, age: "adult" as const },
  medium: "conversation" as const,
  variety: "Kansai-ben",
  tone: "rough" as const,
  note: null,
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

const write = (output: unknown, to: ExampleRequest = request) => {
  const claude = fakeClaude(output as typeof ExamplesOutput.Type)
  return Effect.flatMap(ExampleWriter, (writer) => writer.write(to))
    .pipe(Effect.provide(ExampleWriter.layer.pipe(Layer.provide(claude.layer))), Effect.runPromise)
    .then(({ examples, dropped }) => ({ examples, dropped, asked: claude.asked }))
}

describe("examples prompt", () => {
  it("asks for the casting signals and the dialect rule", () => {
    for (const field of ['"speaker"', '"medium"', '"variety"', '"tone"', '"formality"']) {
      expect(examplesSystem).toContain(field)
    }
    expect(examplesSystem).toMatch(/written entirely in that dialect/)
  })

  it("asks a Japanese word's sentences for English notes only, and every sentence for its gloss", () => {
    expect(examplesSystem).not.toContain('"noteJa"')
    expect(examplesSystem).toContain('"gloss"')
    expect(englishExamplesSystem).toContain('"gloss"')
  })

  it("asks for Japanese notes in the polite style the app speaks in", () => {
    expect(englishExamplesSystem).toContain("です・ます")
  })

  it("asks for no usage note per sense: a sentence's note is about that sentence", () => {
    for (const system of [examplesSystem, englishExamplesSystem]) expect(system).not.toMatch(/usage note/)
  })

  it("tells the writer which senses are dialect and keeps other notes separate", () => {
    const prompt = describeRequest(request)
    expect(prompt).toContain("dialect: Kansai-ben (write every sentence in it)")
    expect(prompt).toContain("notes: colloquial")
    expect(prompt.split("dialect:").length).toBe(2)
  })
})

const group = (
  sense: number,
  examples: Array<ReturnType<typeof written>>,
  extra: Partial<Record<string, unknown>> = {}
) => ({ sense, examples, ...extra }) as never

describe("ExampleWriter.write", () => {
  it("gathers the speaker signals into the sentence's casting and normalises the variety label", async () => {
    const { examples } = await write({ senses: [group(0, [written()])] })
    expect(examples).toHaveLength(1)
    expect(examples[0]).toMatchObject({
      sense: 0,
      formality: "casual",
      casting: {
        speakerGender: "masculine",
        speakerAge: "adult",
        medium: "conversation",
        variety: "kansai",
        tone: "rough"
      }
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
    const { examples } = await write({
      senses: [group(1, [written({ variety: label, gloss: "must not" })])]
    })
    expect(examples[0]?.casting.variety).toBe(expected)
  })

  it("drops a sentence that uses another sense, or a meaning it wasn't given", async () => {
    const { examples, dropped } = await write({
      senses: [
        group(0, [
          written(),
          // An aside the dictionary keeps, or a part of a gloss, still names it.
          written({ gloss: "No good", ja: "あかんわ", furigana: "あかんわ" }),
          written({ gloss: "must not", ja: "行ったらあかん", furigana: "行ったらあかん" }),
          written({ gloss: "hopeless", ja: "もうあかん", furigana: "もうあかん" })
        ])
      ]
    })
    expect(examples.map((example) => example.ja)).toEqual(["それはあかんで", "あかんわ"])
    expect(dropped).toBe(2)
  })

  it("sends the system prompt and the described request", async () => {
    const { asked } = await write({ senses: [] })
    expect(asked[0]?.system).toBe(examplesSystem)
    expect(asked[0]?.prompt).toBe(describeRequest(request))
  })
})

describe("ExampleWriter.write for English words", () => {
  const awkward: ExampleRequest = {
    language: "en",
    headword: "awkward",
    reading: "/ˈɔːkwɚd/",
    otherForms: [],
    perSense: 2,
    senses: [{ index: 0, glosses: ["ぎこちない", "気まずい"], partsOfSpeech: ["adjective"], notes: [], dialects: [] }]
  }

  it("asks for English sentences with Japanese translations and notes", async () => {
    const { examples, asked } = await write(
      {
        senses: [
          {
            sense: 0,
            examples: [
              {
                gloss: "気まずい",
                en: "There was an awkward silence.",
                ja: "気まずい沈黙が流れた。",
                formality: "neutral",
                speaker: { gender: "unspecified", age: "adult" },
                medium: "narration",
                variety: null,
                tone: "neutral",
                noteJa: "「awkward silence」は決まった言い方。"
              }
            ]
          }
        ]
      },
      awkward
    )
    expect(asked[0]?.system).toBe(englishExamplesSystem)
    expect(asked[0]?.prompt).toContain("Headword: awkward (/ˈɔːkwɚd/)")
    expect(asked[0]?.prompt).toContain("0. ぎこちない; 気まずい")
    expect(examples[0]).toMatchObject({
      en: "There was an awkward silence.",
      ja: "気まずい沈黙が流れた。",
      // No readings on the Japanese side: the learner reads it natively.
      furigana: "気まずい沈黙が流れた。",
      note: null,
      noteJa: "「awkward silence」は決まった言い方。",
      casting: {
        speakerGender: "unspecified",
        speakerAge: "adult",
        medium: "narration",
        variety: null,
        tone: "neutral"
      }
    })
  })

  it("leaves out an empty reading", () => {
    expect(describeRequest({ ...awkward, reading: "" })).toContain("Headword: awkward\n")
  })
})
