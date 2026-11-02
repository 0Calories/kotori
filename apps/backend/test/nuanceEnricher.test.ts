import { assert, layer } from "@effect/vitest"
import { ENGLISH_QUESTIONS_VERSION, Jev, NuanceJudge, REVERSED } from "@kotori/ai"
import type { EntryRecord, LoanMeaning } from "@kotori/contracts"
import type { Question, Questions } from "@typesafe-ai/sdk"
import { Effect, Layer, Option } from "effect"
import { Repositories } from "../src/db/Repositories.ts"
import { DictionaryRepo } from "../src/features/dictionary/DictionaryRepo.ts"
import { EnrichmentRepo } from "../src/features/enrichment/EnrichmentRepo.ts"
import { NuanceEnricher } from "../src/features/enrichment/NuanceEnricher.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

const score = (value: number, confidence = 0.9) =>
  ({ type: "score", score: value, confidence, legend: {}, probabilities: {} }) as const
const choice = (value: string, confidence = 0.8) =>
  ({ type: "choice", choice: value, confidence, probabilities: {} }) as const
const noul = (value: number) => ({ type: "noul", noul: value }) as const
/** A loan's Choice, `p` on the meaning Jev picks. */
const meaning = (value: LoanMeaning, p: number) =>
  ({
    type: "choice",
    choice: value,
    confidence: (3 * p - 1) / 2,
    probabilities: { same: 0, divergent: 0, not_english: 0, [value]: p }
  }) as const
/** The `k`th candidate's loan Choice, asked in both option orders, the same answer each way. */
/** Answers by the name a question is stored under: a request names them `s{sense}_{name}`. */
const fakeAnswer = (key: string, question: Question) => {
  const name = key.replace(/^s\d+_/, "")
  switch (question.type) {
    case "score":
      return score(name === "formality" ? 2 : name === "profanity" ? 0 : 1)
    case "choice":
      // A drifted loan: whatever the dictionary has as an English word's katakana candidate diverges.
      return name.startsWith("loan_")
        ? meaning("divergent", 0.9)
        : choice(name.startsWith("difference_") ? "more_casual" : Object.keys(question.criteria)[0]!)
    case "noul":
      return noul(name === "similar_0" || name === "loanword_0" ? 0.9 : name.startsWith("similar_") ? 0.2 : 0.1)
  }
}

const requests: Array<{ readonly state: unknown; readonly questions: Questions }> = []

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state: unknown, questions: Questions) => {
      requests.push({ state, questions })
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, fakeAnswer(name, q)])),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

const sense = (glosses: Array<string>, misc: Array<string> = []) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1"],
  misc,
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  sources: [],
  wasei: false
})

const entry = (id: number, headword: string, reading: string, senses: EntryRecord["senses"]): EntryRecord => ({
  id,
  language: "ja",
  headword,
  reading,
  common: true,
  priority: 100 - id,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses
})

/** An English word with Japanese glosses: its IPA, when the dictionary has one, as its reading. */
const english = (id: number, headword: string, glosses: Array<string>, xrefs: Array<string> = []): EntryRecord => ({
  id,
  language: "en",
  headword,
  reading: headword === "eat" ? "/iːt/" : "",
  common: true,
  priority: 50,
  forms: [
    { kind: "spelling", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [{ ...sense(glosses), pos: ["v"], xrefs }]
})

/** A katakana word, the way JMDict has loanwords. */
const katakana = (id: number, headword: string, glosses: Array<string>): EntryRecord => ({
  ...entry(id, headword, headword, [sense(glosses)]),
  forms: [{ kind: "kana", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }]
})

const TestLayer = NuanceEnricher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Repositories, NuanceJudge.layer.pipe(Layer.provide(FakeJev)))),
  Layer.provideMerge(DatabaseMemory)
)

layer(TestLayer)("NuanceEnricher", (it) => {
  it.effect("classifies each sense and keeps near-synonyms", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([
        entry(1, "食べる", "たべる", [sense(["to eat"]), sense(["to live on"])]),
        entry(2, "食う", "くう", [sense(["to eat"], ["male"])]),
        entry(3, "召し上がる", "めしあがる", [sense(["to eat", "to drink"], ["hon"])])
      ])
      yield* dictionary.saveTags([{ code: "v1", label: "Ichidan verb" }])
      requests.length = 0

      // One request for the whole entry: both senses' questions and the candidate comparisons.
      const summary = yield* (yield* NuanceEnricher).enrich(1)
      assert.deepStrictEqual(summary, { senses: 2, similar: 1, loan: null, inputTokens: 100 })
      assert.strictEqual(requests.length, 1)

      // The state is the entry; each question carries the sense it is about.
      const { state, questions } = requests[0]!
      assert.deepStrictEqual(state, { word: "食べる", reading: "たべる (taberu)", senses: ["to eat", "to live on"] })
      const instructions = (key: string) => questions[key]?.instructions as Record<string, unknown>
      assert.strictEqual(instructions("s1_formality")["meaning"], "to live on")
      assert.deepStrictEqual(instructions("s0_keigo")["part_of_speech"], ["Ichidan verb"])
      assert.deepStrictEqual(
        ["s0_similar_0", "s0_similar_1"].map((key) => instructions(key)["candidate_word"]),
        ["食う", "召し上がる"]
      )
      // Similar words are looked for on the main senses; this one's second sense shares no gloss.
      assert.isUndefined(questions["s1_similar_0"])
      // Japanese words have no katakana loan to judge.
      assert.isUndefined(questions["loanword_0"])

      const repo = yield* EnrichmentRepo
      const saved = yield* repo.nuanceFor([1])
      assert.strictEqual(saved.length, 2)
      assert.strictEqual(saved[0]?.nuance.formality.value, "neutral")
      assert.strictEqual(saved[0]?.questionsVersion, 3)
      assert.deepStrictEqual(yield* repo.loanWordsFor([1]), [])

      const similar = yield* repo.similarFor(1)
      assert.deepStrictEqual(
        similar.map((row) => [row.similarId, row.difference]),
        [[2, "more_casual"]]
      )
    })
  )

  it.effect("judges English words in English terms, against other English words, with their loan", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([
        english(100000001, "eat", ["食べる", "食事をする"], ["consume"]),
        english(100000002, "dine", ["食事をする"]),
        english(100000003, "consume", ["消費する"]),
        english(100000004, "style", ["様式", "流儀"]),
        katakana(9100001, "スタイル", ["(one's) figure; physique", "style"])
      ])
      requests.length = 0

      const enricher = yield* NuanceEnricher
      yield* enricher.enrich(100000001)
      const { state, questions } = requests[0]!
      assert.deepStrictEqual(state, { word: "eat", reading: "/iːt/", senses: ["食べる; 食事をする"] })
      const instructions = (key: string) => questions[key]?.instructions as Record<string, unknown>
      // Its Wiktionary synonym first, then the word sharing a gloss (食事をする).
      assert.deepStrictEqual(
        ["s0_similar_0", "s0_similar_1"].map((key) => instructions(key)["candidate_word"]),
        ["consume", "dine"]
      )
      assert.isUndefined(questions["s0_keigo"])
      assert.notProperty((questions["s0_difference_0"] as { criteria: object }).criteria, "respectful")
      assert.include(String(instructions("s0_formality")["focus"]), "translated into Japanese")
      for (const name of ["variety", "profanity", "textbook"]) assert.isDefined(questions[`s0_${name}`])

      const repo = yield* EnrichmentRepo
      const [nuance] = yield* repo.nuanceFor([100000001])
      assert.strictEqual(nuance?.nuance.keigo.value, "none")
      assert.strictEqual(nuance?.nuance.variety?.value, "universal")
      assert.strictEqual(nuance?.nuance.profanity?.value, "none")
      assert.strictEqual(nuance?.questionsVersion, ENGLISH_QUESTIONS_VERSION)

      // "style" has a katakana loan in JMDict: judged once for the word, in a request of its own
      // beside the senses', whose state is the word without its Japanese senses.
      const summary = yield* enricher.enrich(100000004)
      assert.strictEqual(summary.loan, "スタイル")
      assert.strictEqual(summary.inputTokens, 200)
      const [senses, loans] = requests.slice(1)
      assert.isUndefined(senses!.questions["loan_0"])
      assert.deepStrictEqual(loans!.state, { word: "style" })
      assert.deepStrictEqual(Object.keys(loans!.questions), ["loanword_0", "loan_0", `loan_0${REVERSED}`])
      const loanAsked = loans!.questions["loan_0"]!.instructions as Record<string, unknown>
      assert.strictEqual(loanAsked["katakana_word"], "スタイル")
      const [loan] = yield* repo.loanWordsFor([100000004])
      assert.deepStrictEqual(loan?.verdict, { value: "divergent", probability: 0.9, source: "jev" })
      assert.deepStrictEqual([loan?.word, loan?.trap], ["スタイル", null])
    })
  )

  it.effect("reinterprets stored answers without calling Jev", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([
        entry(4, "走る", "はしる", [sense(["to run"])]),
        english(100000005, "juice", ["果汁", "ジュース"]),
        katakana(9100002, "ジュース", ["juice", "soft drink (usu. fruit-based)"])
      ])
      const enricher = yield* NuanceEnricher
      yield* enricher.enrich(4)
      yield* enricher.enrich(100000005)
      const callsBefore = requests.length

      const repo = yield* EnrichmentRepo
      const [judged] = yield* repo.nuanceFor([4])
      // Corrupt the interpretations; a reinterpretation must rebuild them from the stored answers.
      yield* repo.updateNuance(4, 0, {
        ...judged!.nuance,
        formality: { value: "vulgar", position: 0, confidence: 1, source: "jev" }
      })
      yield* repo.updateLoanWord(100000005, null, null)

      const summary = yield* enricher.reinterpret(4)
      assert.strictEqual(summary.senses, 1)
      const [restored] = yield* repo.nuanceFor([4])
      assert.deepStrictEqual(restored!.nuance, judged!.nuance)
      yield* enricher.reinterpret(100000005)
      const [loan] = yield* repo.loanWordsFor([100000005])
      assert.strictEqual(loan?.word, "ジュース")
      // Both orders' answers are kept, so the averaged verdict can be re-derived.
      const stored = Option.getOrThrow(yield* repo.loanAnswersFor(100000005)) as Record<string, unknown>
      assert.includeMembers(Object.keys(stored), ["loanword_0", "loan_0", `loan_0${REVERSED}`, "candidates"])
      assert.strictEqual(requests.length, callsBefore)
    })
  )
})
