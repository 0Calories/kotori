import { PITFALL_KINDS } from "@kotori/contracts"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  checkPitfalls,
  Claude,
  formProbabilities,
  formRequest,
  GOLDEN_DRAFTS,
  GOLDEN_FORM,
  GOLDEN_LOANS,
  GOLDEN_PITFALLS,
  interpretLoan,
  type LoanCandidate,
  loanRequest,
  namesSenseByNumber,
  pitfallPrompt,
  pitfallVerdict,
  PitfallWriter,
  precision,
  recall,
  tally,
  type WordToJudge
} from "../src/index.ts"

const kekkou: WordToJudge = {
  headword: "結構",
  reading: "けっこう",
  senses: [
    { glosses: ["splendid", "fine"], pos: ["adj-na"], labels: [], notes: [] },
    { glosses: ["no, thank you"], pos: ["adj-na"], labels: [], notes: ["usu. as 結構です"] }
  ]
}

const pitfall = (overrides: Partial<{ kind: string; text: string; sense: number | null; about: string | null }>) => ({
  kind: "set_phrase",
  text: "結構です usually declines.",
  sense: null,
  about: null,
  ...overrides
})

describe("form questions", () => {
  it("asks one Noul per sense, carrying the word, its meaning and the dictionary's notes", () => {
    const request = formRequest([
      { word: kekkou, sense: 0 },
      { word: kekkou, sense: 1 }
    ])
    expect(Object.keys(request.questions)).toEqual(["s0", "s1"])
    expect(request.questions["s1"]!.instructions).toMatchObject({
      word: "結構",
      reading: "けっこう",
      meaning: "no, thank you",
      part_of_speech: "na-adjective",
      dictionary_notes: "usu. as 結構です"
    })
  })

  it("reads each sense's yes probability, null where Jev gave none", () => {
    expect(formProbabilities({ s0: { type: "noul", noul: 0.8 } }, 2)).toEqual([0.8, null])
  })
})

describe("loan verdicts", () => {
  const candidates: ReadonlyArray<LoanCandidate> = [
    { katakana: "トラック", meanings: ["truck; lorry"], wasei: false, by: "gloss" },
    { katakana: "ローリー", meanings: ["lorry"], wasei: false, by: "gloss" }
  ]
  const meaning = (same: number, divergent: number) => ({
    type: "choice",
    choice: same > divergent ? "same" : "divergent",
    confidence: 1,
    probabilities: { same, divergent, not_english: 1 - same - divergent }
  })

  it("asks whether each candidate is the loan, and its meaning in both option orders", () => {
    const request = loanRequest("lorry", candidates)
    expect(Object.keys(request.questions)).toEqual([
      "loanword_0",
      "loan_0",
      "loan_0~reversed",
      "loanword_1",
      "loan_1",
      "loan_1~reversed"
    ])
  })

  it("takes the likeliest loan and a meaning only when sure", () => {
    const answers = {
      loanword_0: { type: "noul", noul: 0.2 },
      loanword_1: { type: "noul", noul: 0.9 },
      loan_1: meaning(0.9, 0.05),
      "loan_1~reversed": meaning(0.8, 0.15)
    }
    expect(interpretLoan(answers, candidates)).toMatchObject({ katakana: "ローリー", meaning: "same" })
    const unsure = { ...answers, loan_1: meaning(0.6, 0.35), "loan_1~reversed": meaning(0.6, 0.35) }
    expect(interpretLoan(unsure, candidates)).toMatchObject({ katakana: "ローリー", meaning: null })
  })

  it("counts no candidate below LOAN_IS, but a JMdict source always", () => {
    const answers = {
      loanword_0: { type: "noul", noul: 0.4 },
      loan_0: meaning(0.1, 0.85),
      "loan_0~reversed": meaning(0.1, 0.85)
    }
    expect(interpretLoan(answers, candidates.slice(0, 1)).katakana).toBeNull()
    const named = [{ ...candidates[0]!, by: "source" as const }]
    expect(interpretLoan(answers, named)).toMatchObject({ katakana: "トラック", meaning: "divergent" })
  })
})

describe("checkPitfalls", () => {
  it("keeps valid pitfalls, a sense by position, and drops the rest with why", () => {
    const { pitfalls, dropped } = checkPitfalls(
      [
        pitfall({ sense: 2, about: "大丈夫" }),
        pitfall({ kind: "false_friend" }),
        pitfall({ sense: 3 }),
        pitfall({ text: "In sense 2 it declines." }),
        pitfall({ text: "  " }),
        pitfall({ about: "結構" })
      ],
      kekkou,
      "ja"
    )
    expect(pitfalls).toEqual([
      { kind: "set_phrase", text: "結構です usually declines.", sense: 1, about: "大丈夫" },
      { kind: "set_phrase", text: "結構です usually declines.", sense: null, about: null }
    ])
    expect(dropped.map((drop) => drop.reason)).toEqual(["kind", "sense", "numbered", "empty"])
  })

  it("keeps at most three", () => {
    const { pitfalls, dropped } = checkPitfalls(
      [1, 2, 3, 4].map(() => pitfall({})),
      kekkou,
      "ja"
    )
    expect(pitfalls).toHaveLength(3)
    expect(dropped.map((drop) => drop.reason)).toEqual(["cap"])
  })

  it("spots a sense named by its number, in either language", () => {
    for (const text of ["In sense 2, it means no.", "(2) is a refusal", "2番目の意味では断りです", "語義2では"]) {
      expect(namesSenseByNumber(text), text).toBe(true)
    }
    for (const text of ["Say it twice: 2 times.", "In the sense 'no, thank you', it declines."]) {
      expect(namesSenseByNumber(text), text).toBe(false)
    }
  })
})

describe("PitfallWriter", () => {
  it("numbers the words for Claude and marks one it skipped as missing", async () => {
    const asked: Array<string> = []
    const claude = Layer.succeed(
      Claude,
      Claude.of({
        model: "fake",
        available: Effect.succeed(true),
        generate: (options) =>
          Effect.sync(() => {
            asked.push(options.prompt)
            return { words: [{ word: 2, pitfalls: [pitfall({ sense: 2 })] }] } as never
          })
      })
    )
    const results = await Effect.flatMap(PitfallWriter, (writer) => writer.write([kekkou, kekkou], "ja")).pipe(
      Effect.provide(PitfallWriter.layer.pipe(Layer.provide(claude))),
      Effect.runPromise
    )
    expect(results[0]!.missing).toBe(true)
    expect(results[1]!.pitfalls).toEqual([
      { kind: "set_phrase", text: "結構です usually declines.", sense: 1, about: null }
    ])
    expect(asked[0]).toContain("1. 結構（けっこう）")
    expect(asked[0]).toContain("note: usu. as 結構です")
  })

  it("shows an English word's katakana loan and its verdict", () => {
    const prompt = pitfallPrompt(
      [
        {
          headword: "juice",
          reading: "",
          senses: [{ glosses: ["ジュース"], pos: ["n"], labels: [], notes: [] }],
          loan: { word: "ジュース", meaning: "divergent", glosses: ["soft drink"] }
        }
      ],
      "en"
    )
    expect(prompt).toContain("katakana loan: ジュース (has drifted in meaning): soft drink")
  })
})

describe("scoring", () => {
  it("measures precision and recall", () => {
    const t = tally([
      { expected: true, got: true },
      { expected: true, got: false },
      { expected: false, got: true },
      { expected: false, got: false }
    ])
    expect([precision(t), recall(t)]).toEqual([0.5, 0.5])
  })

  it("judges a pitfall by kind, sense and what it mentions", () => {
    const wanted = { kinds: ["confusable" as const], sense: 1, mentions: ["お願い"] }
    const written = { kind: "confusable", text: "To accept, say お願いします.", sense: 1, about: null }
    expect(pitfallVerdict(wanted, [written]).pass).toBe(true)
    expect(pitfallVerdict(wanted, [{ ...written, sense: null }]).pass).toBe(false)
    expect(pitfallVerdict(wanted, [{ ...written, sense: null }], { anySense: true }).pass).toBe(true)
    expect(pitfallVerdict(wanted, [{ ...written, text: "It declines." }]).pass).toBe(false)
    expect(pitfallVerdict({ none: true }, [written]).pass).toBe(false)
    expect(pitfallVerdict({ none: true }, []).pass).toBe(true)
  })
})

describe("golden sets", () => {
  it("ask about senses that exist and carry no register label", () => {
    for (const golden of GOLDEN_FORM) {
      const sense = golden.word.senses[golden.sense]
      expect(sense, golden.word.headword).toBeDefined()
      expect(sense!.labels, golden.word.headword).toEqual([])
    }
  })

  it("expect only kinds the word's direction allows, on senses that exist", () => {
    for (const golden of [...GOLDEN_PITFALLS, ...GOLDEN_DRAFTS.map((draft) => ({ ...draft, word: null }))]) {
      if (golden.expect.none === true) continue
      for (const kind of golden.expect.kinds) expect(PITFALL_KINDS[golden.language]).toContain(kind)
      if (golden.word !== null && golden.expect.sense !== undefined) {
        expect(golden.word.senses[golden.expect.sense]).toBeDefined()
      }
    }
  })

  it("name a loan that is among the word's candidates", () => {
    for (const golden of GOLDEN_LOANS) {
      expect(golden.candidates.length, golden.english).toBeGreaterThan(0)
      if (golden.katakana !== undefined) {
        expect(golden.candidates.map((candidate) => candidate.katakana)).toContain(golden.katakana)
      }
    }
  })
})
