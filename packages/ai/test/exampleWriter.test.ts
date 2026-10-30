import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  Claude,
  describeLoan,
  describeRequest,
  ExamplesOutput,
  ExampleWriter,
  LoanOutput,
  LoanWriter
} from "../src/index.ts"
import type { ExampleRequest, LoanRequest } from "../src/index.ts"
import { englishExamplesSystem, examplesSystem, loanSystem } from "../src/prompts.ts"

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
const fakeClaude = (output: typeof ExamplesOutput.Type | typeof LoanOutput.Type) => {
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
    .then(({ examples, notes, dropped }) => ({ examples, notes, dropped, asked: claude.asked }))
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

  it("asks for Japanese notes and warnings in the polite style the app speaks in", () => {
    expect(englishExamplesSystem).toContain("です・ます")
    expect(loanSystem).toContain("です・ます")
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
) => ({ sense, note: null, examples, ...extra }) as never

describe("ExampleWriter.write", () => {
  it("flattens the speaker and normalises the variety label", async () => {
    const { examples } = await write({ senses: [group(0, [written()])] })
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
    const { examples } = await write({
      senses: [group(1, [written({ variety: label, gloss: "must not" })])]
    })
    expect(examples[0]?.variety).toBe(expected)
  })

  it("keeps the usage note of each known sense", async () => {
    const { notes } = await write({
      senses: [
        group(0, [written()], { note: "Kansai speech." }),
        group(1, []),
        group(9, [], { note: "Not a listed sense." })
      ]
    })
    // A Japanese word's note is for learners of Japanese, in English.
    expect(notes).toEqual([
      { sense: 0, note: "Kansai speech.", noteJa: null },
      { sense: 1, note: null, noteJa: null }
    ])
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
    const { examples, notes, asked } = await write(
      {
        senses: [
          {
            sense: 0,
            noteJa: "人間関係の気まずさにも、動作のぎこちなさにも使える。",
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
      variety: null
    })
    // An English word's note is for Japanese speakers, in Japanese.
    expect(notes).toEqual([{ sense: 0, note: null, noteJa: "人間関係の気まずさにも、動作のぎこちなさにも使える。" }])
  })

  it("leaves out an empty reading", () => {
    expect(describeRequest({ ...awkward, reading: "" })).toContain("Headword: awkward\n")
  })
})

const loanRequest: LoanRequest = {
  headword: "style",
  reading: "/staɪl/",
  meanings: ["様式; 型", "流行; ファッション", "花柱 [botany]"],
  loanWord: "スタイル",
  loanMeanings: ["(one's) figure; build; physique", "style"]
}

const writeLoan = (output: typeof LoanOutput.Type) => {
  const claude = fakeClaude(output)
  return Effect.flatMap(LoanWriter, (writer) => writer.write(loanRequest))
    .pipe(Effect.provide(LoanWriter.layer.pipe(Layer.provide(claude.layer))), Effect.runPromise)
    .then((trap) => ({ trap, asked: claude.asked }))
}

describe("LoanWriter.write", () => {
  it("names the English word with its senses, and the katakana loan with its meanings", async () => {
    const { asked } = await writeLoan({ loanTrap: "" })
    expect(asked[0]?.system).toBe(loanSystem)
    expect(asked[0]?.prompt).toBe(describeLoan(loanRequest))
    expect(asked[0]?.prompt).toBe(
      [
        "English word: style (/staɪl/)",
        "Its senses in the dictionary, in Japanese:",
        "1. 様式; 型",
        "2. 流行; ファッション",
        "3. 花柱 [botany]",
        "Katakana loanword: スタイル",
        "Its meanings in Japanese, translated into English:",
        "1. (one's) figure; build; physique",
        "2. style"
      ].join("\n")
    )
    // Not every listed sense is what the word means: the writer is told which to describe.
    expect(loanSystem).toContain("its main everyday meaning")
  })

  it("keeps the warning Claude wrote, and none when it is blank", async () => {
    expect((await writeLoan({ loanTrap: " 日本語の「スタイル」は体型を指すことが多いです。 " })).trap).toBe(
      "日本語の「スタイル」は体型を指すことが多いです。"
    )
    expect((await writeLoan({ loanTrap: "  " })).trap).toBeNull()
  })
})
