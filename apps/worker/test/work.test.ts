import { assert, layer } from "@effect/vitest"
import { Claude, ExampleWriter, LoanOutput, LoanWriter } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, JobsRepo, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Jev, JevError, NuanceEnricher } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Enrichers } from "../src/Enrichers.ts"
import { makeJobRunner } from "../src/JobRunner.ts"

// The worker's real enrichers and repositories on PGlite; only the paid providers are fakes.

let jevDown = false

/** The parts of a Jev question the fake reads. */
interface Asked {
  readonly type: string
  readonly instructions?: unknown
  readonly criteria?: unknown
}

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (_state, questions) => {
      if (jevDown) return Effect.fail(new JevError({ message: "Jev is down" }))
      // Whatever Jev's answer types require: the first option of every choice, a likely first
      // candidate, and a drifted loan for スタイル, by the name a question is stored under
      // (requests key a sense's `s{sense}_{name}`, and an English word's loans `loan_{k}`).
      const answer = (key: string, question: Asked) => {
        const name = key.replace(/^s\d+_/, "")
        const katakana = (question.instructions as { readonly katakana_word?: string } | null)?.katakana_word
        switch (question.type) {
          case "score":
            return {
              type: "score",
              score: name === "formality" ? 2 : name === "profanity" ? 0 : 1,
              confidence: 0.9,
              legend: {},
              probabilities: {}
            }
          case "choice": {
            const choice = name.startsWith("difference_")
              ? "more_casual"
              : name.startsWith("loan_") && katakana === "スタイル"
                ? "diverges"
                : Object.keys(question.criteria ?? {})[0]!
            return { type: "choice", choice, confidence: 0.8, probabilities: {} }
          }
          default:
            return { type: "noul", noul: name === "similar_0" || name.startsWith("loanword_") ? 0.9 : 0.1 }
        }
      }
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, answer(name, q)])),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

let loanRequests = 0

const FakeClaude = Layer.succeed(
  Claude,
  Claude.of({
    model: "claude-test",
    available: Effect.succeed(true),
    generate: (options) =>
      (options.schema as unknown) === LoanOutput
        ? Effect.sync(() => {
            loanRequests++
            return { loanTrap: "日本語の「スタイル」は体型を指すことが多いです。" } as never
          })
        : Effect.succeed({
            senses: [
              {
                sense: 0,
                note: "An everyday verb.",
                examples: [
                  {
                    ja: "パンを食べる。",
                    furigana: "パンを{食|た}べる。",
                    en: "I eat bread.",
                    formality: "neutral",
                    speaker: { gender: "unspecified", age: "unspecified" },
                    medium: "conversation",
                    variety: null,
                    tone: "neutral",
                    note: null
                  }
                ]
              }
            ]
          } as never)
  })
)

const spoken: Array<string> = []
const FakeElevenLabs = Layer.succeed(
  ElevenLabs,
  ElevenLabs.of({
    configured: true,
    model: "tts-test",
    synthesize: (text) => Effect.sync(() => (spoken.push(text), new TextEncoder().encode(`mp3:${text}`)))
  })
)

const TestLayer = Enrichers.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      NuanceEnricher.layer.pipe(Layer.provideMerge(FakeJev)),
      Layer.mergeAll(ExampleWriter.layer, LoanWriter.layer).pipe(Layer.provideMerge(FakeClaude)),
      Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(FakeElevenLabs, AudioStore.layer, FakeJev)))
    )
  ),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseMemory)
)

const sense = (glosses: Array<string>) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1"],
  misc: [],
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

const entry = (id: number, headword: string, reading: string, senses: Array<Array<string>>): EntryRecord => ({
  id,
  language: "ja",
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: senses.map(sense)
})

const taberu = 1358280
const kuu = 1269130
const style = 1069520
const styleEnglish = 100001699

/** Runs cycles until the queue has nothing runnable, returning how many jobs ran. */
const drain = (step: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    let ran = 0
    while (yield* step) ran++
    return ran
  })

layer(TestLayer)("kotori work", (it) => {
  it.effect("runs queued enrichment into the new tables, voicing examples once they exist", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      yield* dictionary.insertEntries([
        entry(taberu, "食べる", "たべる", [["to eat"], ["to live on (e.g. a salary)"]]),
        entry(kuu, "食う", "くう", [["to eat"]])
      ])

      const kinds = yield* (yield* Enrichers).available
      assert.deepStrictEqual(kinds, ["nuance", "examples", "audio"])
      const step = yield* makeJobRunner(kinds)

      // What the API does when a learner opens an entry.
      yield* jobs.enqueue("nuance", taberu, 100, 0)
      yield* jobs.enqueue("examples", taberu, 100, 0)
      assert.strictEqual(yield* drain(step), 3)

      assert.deepStrictEqual(
        (yield* enrichment.nuanceFor([taberu])).map((row) => [row.sense, row.model]),
        [
          [0, "jev-test"],
          [1, "jev-test"]
        ]
      )
      assert.deepStrictEqual(
        (yield* enrichment.similarFor(taberu)).map((row) => [row.sense, row.similarId, row.difference]),
        [[0, kuu, "more_casual"]]
      )
      const [example] = yield* enrichment.examplesFor([taberu])
      assert.strictEqual(example?.furigana, "パンを{食|た}べる。")
      assert.strictEqual(example?.model, "claude-test")

      // The audio job was queued by the examples job: headword and sentence are both voiced,
      // the headword once per cast dictionary voice (Kyoko and the announcer), the sentence in
      // Japanese, which is what its learners are learning.
      assert.deepStrictEqual(spoken, ["たべる", "たべる", "パンを食べる。"])
      assert.isTrue((yield* enrichment.entryAudio([taberu])).has(taberu))
      const clips = yield* enrichment.exampleAudio([example!.id])
      assert.deepStrictEqual([...clips.keys()], [`${example!.id}:ja`])
      assert.deepStrictEqual(
        [...(yield* jobs.statusFor(taberu))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "done"],
          ["examples", "done"],
          ["nuance", "done"]
        ]
      )
    })
  )

  it.effect("judges an English word with its katakana loan, naming a drifted one's trap once", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      yield* dictionary.insertEntries([
        {
          ...entry(styleEnglish, "style", "/staɪl/", [["型", "様式"], ["やり方"]]),
          language: "en",
          forms: [
            {
              kind: "spelling",
              text: "style",
              common: true,
              tags: [],
              priorities: [],
              restrictions: [],
              noKanji: false
            }
          ]
        },
        {
          ...entry(style, "スタイル", "スタイル", [["(one's) figure", "physique"], ["style"]]),
          forms: [
            { kind: "kana", text: "スタイル", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
          ]
        }
      ])
      const step = yield* makeJobRunner(["nuance"])

      // What the API queues when a Japanese speaker opens the English word.
      yield* jobs.enqueue("nuance", styleEnglish, 100, 0)
      assert.strictEqual(yield* drain(step), 1)
      const judged = Effect.map(enrichment.loanWordsFor([styleEnglish]), (rows) =>
        rows.map((row) => [row.word, row.verdict?.value, row.trap])
      )
      // The dictionary has a katakana word for "style"; Jev judged that it drifted.
      const warned = ["スタイル", "diverges", "日本語の「スタイル」は体型を指すことが多いです。"]
      assert.deepStrictEqual(yield* judged, [warned])
      assert.strictEqual((yield* enrichment.nuanceFor([styleEnglish])).length, 2)
      assert.strictEqual(loanRequests, 1)

      // Judging the word again keeps the warning instead of paying Claude for it twice.
      yield* jobs.requeue("nuance", styleEnglish, 100, 0)
      assert.strictEqual(yield* drain(step), 1)
      assert.deepStrictEqual(yield* judged, [warned])
      assert.strictEqual(loanRequests, 1)
    })
  )

  it.effect("puts a failed job back with a delay and runs it once that has passed", () =>
    Effect.gen(function* () {
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const step = yield* makeJobRunner(["nuance"])

      jevDown = true
      yield* jobs.enqueue("nuance", kuu, 10, 0)
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobs.statusFor(kuu)).get("nuance"), "queued")
      assert.isFalse(yield* step)

      jevDown = false
      yield* TestClock.adjust("61 seconds")
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobs.statusFor(kuu)).get("nuance"), "done")
      assert.strictEqual((yield* enrichment.nuanceFor([kuu])).length, 1)
    })
  )
})
