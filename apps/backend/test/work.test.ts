import { assert, layer } from "@effect/vitest"
import {
  Claude,
  ElevenLabs,
  ExampleWriter,
  Jev,
  JevError,
  LoanOutput,
  LoanWriter,
  NuanceJudge,
  Pronouncer
} from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "../src/db/Database.ts"
import { AudioStore } from "../src/features/audio/AudioStore.ts"
import { entryClips, exampleClips } from "../src/features/audio/queries.ts"
import { Speech } from "../src/features/audio/Speech.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { AudioEnricher } from "../src/features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../src/features/enrichment/Enrichers.ts"
import { enqueueJob, jobStatusFor, requeueJob } from "../src/features/enrichment/jobs.ts"
import { NuanceEnricher } from "../src/features/enrichment/NuanceEnricher.ts"
import { examplesFor, loanWordsFor, nuanceFor, similarFor } from "../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"
import { makeJobRunner } from "../src/worker/JobRunner.ts"

// The worker's real enrichers and queries on PGlite; only the paid providers are fakes.

let jevDown = false
let jevRequests = 0

/** The katakana loans the fake judges to mislead. */
const DRIFTED = new Set(["スタイル", "マンション"])
/** The fake's warning, whatever the loan. */
const WARNING = "日本語のカタカナ語の意味では通じません。"

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
      jevRequests++
      // Whatever Jev's answer types require: the first option of every choice, a likely first
      // candidate, and a drifted loan for スタイル and マンション, by the name a question is stored
      // under (requests key a sense's `s{sense}_{name}`, and an English word's loans `loan_{k}`).
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
            if (name.startsWith("loan_")) {
              const meaning = DRIFTED.has(katakana ?? "") ? "divergent" : "same"
              return { type: "choice", choice: meaning, confidence: 0.85, probabilities: { [meaning]: 0.9 } }
            }
            const choice = name.startsWith("difference_") ? "more_casual" : Object.keys(question.criteria ?? {})[0]!
            return { type: "choice", choice, confidence: 0.8, probabilities: {} }
          }
          default:
            return {
              type: "noul",
              noul: name === "similar_0" || name.startsWith("loanword_") ? 0.9 : 0.1
            }
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
const loanPrompts: Array<string> = []
/** Whether the Claude probe succeeds: false as with no key, a bad one, or a probe that timed out. */
let claudeUp = true

const FakeClaude = Layer.succeed(
  Claude,
  Claude.of({
    model: "claude-test",
    available: Effect.sync(() => claudeUp),
    generate: (options) =>
      (options.schema as unknown) === LoanOutput
        ? Effect.sync(() => {
            loanRequests++
            loanPrompts.push(options.prompt)
            return { loanTrap: WARNING } as never
          })
        : Effect.succeed({
            senses: [
              {
                sense: 0,
                note: "An everyday verb.",
                examples: [
                  {
                    gloss: "to eat",
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
  Layer.provideMerge(Layer.mergeAll(NuanceEnricher.layer, AudioEnricher.layer)),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(
    Layer.mergeAll(AudioStore.database, NuanceJudge.layer, ExampleWriter.layer, LoanWriter.layer, Pronouncer.layer)
  ),
  Layer.provideMerge(Layer.mergeAll(FakeJev, FakeClaude, FakeElevenLabs)),
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
  id: EntryId.make(id),
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

const taberu = EntryId.make(1358280)
const kuu = EntryId.make(1269130)
const style = EntryId.make(1069520)
const styleEnglish = EntryId.make(100001699)

/** Runs cycles until the queue has nothing runnable, returning how many jobs ran. */
const drain = (step: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    let ran = 0
    while (yield* step) ran++
    return ran
  })

layer(TestLayer)("the worker", (it) => {
  it.effect("runs queued enrichment into the new tables, voicing examples once they exist", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        entry(taberu, "食べる", "たべる", [["to eat"], ["to live on (e.g. a salary)"]]),
        entry(kuu, "食う", "くう", [["to eat"]])
      ])

      assert.deepStrictEqual(yield* (yield* Enrichers).available, ["nuance", "examples", "audio"])
      const step = yield* makeJobRunner()

      // What the API does when a learner opens an entry.
      yield* enqueueJob(db, "nuance", taberu, 100, new Date(0))
      yield* enqueueJob(db, "examples", taberu, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 3)

      assert.deepStrictEqual(
        (yield* nuanceFor(db, [taberu])).map((row) => [row.sense, row.model]),
        [
          [0, "jev-test"],
          [1, "jev-test"]
        ]
      )
      assert.deepStrictEqual(
        (yield* similarFor(db, taberu)).map((row) => [row.sense, row.similarId, row.difference]),
        [[0, kuu, "more_casual"]]
      )
      const [example] = yield* examplesFor(db, [taberu])
      assert.strictEqual(example?.furigana, "パンを{食|た}べる。")
      assert.strictEqual(example?.model, "claude-test")

      // The audio job was queued by the examples job: headword and sentence are both voiced,
      // the headword once per cast dictionary voice (Kyoko and the announcer), the sentence in
      // Japanese, which is what its learners are learning.
      assert.deepStrictEqual(spoken, ["たべる", "たべる", "パンを食べる。"])
      assert.isTrue((yield* entryClips(db, [taberu])).has(taberu))
      const clips = yield* exampleClips(db, [example!.id])
      assert.deepStrictEqual([...clips.keys()], [`${example!.id}:ja`])
      assert.deepStrictEqual(
        [...(yield* jobStatusFor(db, taberu))].sort(([a], [b]) => a.localeCompare(b)),
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
      const db = yield* Database
      yield* insertEntries(db, [
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
      const step = yield* makeJobRunner()

      // What the API queues when a Japanese speaker opens the English word.
      yield* enqueueJob(db, "nuance", styleEnglish, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 1)
      const judged = Effect.map(loanWordsFor(db, [styleEnglish]), (rows) =>
        rows.map((row) => [row.word, row.verdict?.value, row.trap])
      )
      // The dictionary has a katakana word for "style"; Jev judged that it drifted.
      const warned = ["スタイル", "divergent", WARNING]
      assert.deepStrictEqual(yield* judged, [warned])
      assert.strictEqual((yield* nuanceFor(db, [styleEnglish])).length, 2)
      assert.strictEqual(loanRequests, 1)

      // Judging the word again keeps the warning instead of paying Claude for it twice.
      yield* requeueJob(db, "nuance", styleEnglish, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 1)
      assert.deepStrictEqual(yield* judged, [warned])
      assert.strictEqual(loanRequests, 1)
    })
  )

  it.effect("writes a loan warning skipped while Claude was unavailable once it is back, without Jev", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const mansion = EntryId.make(100001700)
      yield* insertEntries(db, [
        {
          // Its seventh sense, beyond the six judged, is glossed with the loan itself.
          ...entry(mansion, "mansion", "/ˈmænʃən/", [
            ["大邸宅"],
            ["館"],
            ["屋敷"],
            ["（月の）宿"],
            ["住まい"],
            ["邸"],
            ["マンション", "分譲マンション"]
          ]),
          language: "en",
          forms: []
        },
        {
          ...entry(1130040, "マンション", "マンション", [["condominium", "mansion"]]),
          forms: [
            {
              kind: "kana",
              text: "マンション",
              common: true,
              tags: [],
              priorities: [],
              restrictions: [],
              noKanji: false
            }
          ]
        }
      ])
      const step = yield* makeJobRunner()
      const before = { jev: jevRequests, claude: loanRequests }
      const trap = Effect.map(loanWordsFor(db, [mansion]), ([row]) => [row?.verdict?.value, row?.trap])

      // Judged while the Claude probe fails: the verdict is saved, the warning skipped.
      claudeUp = false
      yield* enqueueJob(db, "nuance", mansion, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 1)
      assert.deepStrictEqual(yield* trap, ["divergent", null])
      assert.strictEqual(jevRequests - before.jev, 2)

      // Queued again while Claude is still away, the job leaves it to a later try.
      yield* requeueJob(db, "nuance", mansion, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 1)
      assert.deepStrictEqual(yield* trap, ["divergent", null])

      // Claude is back: the next run writes the warning, and doesn't ask Jev again.
      claudeUp = true
      yield* requeueJob(db, "nuance", mansion, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 1)
      assert.deepStrictEqual(yield* trap, ["divergent", WARNING])
      assert.strictEqual(jevRequests - before.jev, 2)
      assert.strictEqual(loanRequests - before.claude, 1)
      // Written from the senses that bear on the loan, the seventh among them, and the loan's own meanings.
      const prompt = loanPrompts.at(-1)!
      assert.include(prompt, "1. 大邸宅")
      assert.include(prompt, "7. マンション; 分譲マンション")
      assert.include(prompt, "Katakana loanword: マンション")
      assert.include(prompt, "1. condominium; mansion")
    })
  )

  it.effect("puts a failed job back with a delay and runs it once that has passed", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const step = yield* makeJobRunner()

      jevDown = true
      yield* enqueueJob(db, "nuance", kuu, 10, new Date(0))
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobStatusFor(db, kuu)).get("nuance"), "queued")
      assert.isFalse(yield* step)

      jevDown = false
      yield* TestClock.adjust("61 seconds")
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobStatusFor(db, kuu)).get("nuance"), "done")
      assert.strictEqual((yield* nuanceFor(db, [kuu])).length, 1)
    })
  )

  it.effect("claims a kind whose provider was unavailable when the worker started once it is back", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const nabe = EntryId.make(1000)
      yield* insertEntries(db, [entry(nabe, "鍋", "なべ", [["pot"]])])
      // The worker starts while the Claude probe fails, as it can during a deploy.
      claudeUp = false
      const step = yield* makeJobRunner()

      yield* enqueueJob(db, "examples", nabe, 100, new Date(0))
      assert.isFalse(yield* step)
      assert.strictEqual((yield* jobStatusFor(db, nabe)).get("examples"), "queued")

      // Claude is back: the same runner picks the job up, and voices the new examples too.
      claudeUp = true
      assert.strictEqual(yield* drain(step), 2)
      assert.deepStrictEqual(
        [...(yield* jobStatusFor(db, nabe))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "done"],
          ["examples", "done"]
        ]
      )
    })
  )
})
