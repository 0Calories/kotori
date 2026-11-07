import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { Effect, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import {
  audioCharactersSince,
  entryClips,
  exampleClips,
  findAudio,
  linkEntryAudio,
  linkExampleAudio,
  saveAudio
} from "../../src/features/audio/queries.ts"
import { entriesByPriority, getEntries, insertEntries } from "../../src/features/dictionary/queries.ts"
import {
  examplesFor,
  loanAnswersFor,
  loanWordsFor,
  nuanceEntryIds,
  nuanceFor,
  outdatedNuanceEntryIds,
  saveCasting,
  saveExamples,
  saveLoanTrap,
  saveLoanWord,
  saveNuance,
  saveSimilar,
  similarFor,
  updateLoanWord
} from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries, sense } from "../fixtures.ts"

const TestLayer = DatabaseMemory

layer(TestLayer)("enrichment queries", (it) => {
  it.effect("stores nuance, examples and audio per sense and replaces them on re-enrichment", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, entries)
      const taberu = EntryId.make(1358280)
      const judgment = { value: "neutral" as const, confidence: 0.9, source: "jev" as const }
      const nuance = {
        formality: { value: "neutral" as const, position: 0.5, confidence: 0.9, source: "jev" as const },
        medium: { value: "both" as const, position: 0.5, confidence: 0.8, source: "jev" as const },
        keigo: { ...judgment, value: "none" as const },
        gender: judgment,
        age: { ...judgment, value: "any" as const },
        currency: { ...judgment, value: "current" as const },
        connotation: judgment,
        cautions: { rudeToSuperiors: 0.1, stiffWithFriends: 0.1, slang: 0.05 }
      }
      yield* saveNuance(
        db,
        taberu,
        [{ sense: 0, nuance, answers: { raw: true }, model: "jev-1", questionsVersion: 1 }],
        new Date(1000)
      )
      assert.deepStrictEqual((yield* nuanceFor(db, [taberu]))[0]?.nuance, nuance)
      assert.deepStrictEqual(yield* entriesByPriority(db, { limit: 1, missing: "nuance" }), [1269130])

      // Rows judged by an older question set of their language are found for the backfill.
      const outdated = (ja: number, en: number, language?: "ja" | "en") =>
        outdatedNuanceEntryIds(db, { ja, en }, { commonOnly: false, limit: 10, language })
      assert.deepStrictEqual(yield* outdated(2, 1), [taberu])
      assert.deepStrictEqual(yield* outdated(1, 2), [])
      assert.deepStrictEqual(yield* outdated(2, 1, "en"), [])
      assert.deepStrictEqual(yield* nuanceEntryIds(db, "ja"), [taberu])
      assert.deepStrictEqual(yield* nuanceEntryIds(db, "en"), [])

      // An English word's loan verdict: Claude's warning survives a re-judge that names the same
      // loan, a warning for another loan isn't written, and the warning goes when the loan changes.
      const loanInput = (word: string | null) => ({
        word,
        verdict: word === null ? null : { value: "divergent" as const, probability: 0.9, source: "jev" as const },
        answers: { raw: true },
        model: "jev-1",
        questionsVersion: 3
      })
      const loanRow = Effect.map(loanWordsFor(db, [taberu]), (rows) =>
        rows.map((row) => [row.word, row.verdict?.value ?? null, row.trap])
      )
      yield* saveLoanWord(db, taberu, loanInput("スタイル"), new Date(1000))
      yield* saveLoanTrap(db, taberu, "タイプ", "古い警告")
      yield* saveLoanTrap(db, taberu, "スタイル", "意味が違う")
      yield* saveLoanWord(db, taberu, loanInput("スタイル"), new Date(2000))
      assert.deepStrictEqual(yield* loanRow, [["スタイル", "divergent", "意味が違う"]])
      assert.deepStrictEqual(Option.getOrThrow(yield* loanAnswersFor(db, taberu)), { raw: true })
      // Reinterpreting into the same loan keeps the warning; into none drops it.
      yield* updateLoanWord(db, taberu, "スタイル", { value: "divergent", probability: 0.8, source: "jev" })
      assert.deepStrictEqual(yield* loanRow, [["スタイル", "divergent", "意味が違う"]])
      yield* updateLoanWord(db, taberu, null, null)
      assert.deepStrictEqual(yield* loanRow, [[null, null, null]])
      yield* saveLoanWord(db, taberu, loanInput("タイプ"), new Date(3000))
      assert.deepStrictEqual(yield* loanRow, [["タイプ", "divergent", null]])
      yield* saveLoanWord(db, taberu, null, new Date(4000))
      assert.deepStrictEqual(yield* loanRow, [])
      assert.isTrue(Option.isNone(yield* loanAnswersFor(db, taberu)))

      yield* saveSimilar(db, taberu, [
        { sense: 0, similarId: EntryId.make(1269130), similarity: 0.8, difference: "more_casual", confidence: 0.7 }
      ])
      assert.strictEqual((yield* similarFor(db, taberu))[0]?.difference, "more_casual")

      const example = {
        ja: "ご飯を食べる",
        furigana: "ご{飯|はん}を{食|た}べる",
        en: "to eat a meal",
        note: null,
        model: "m"
      }
      yield* saveExamples(db, taberu, [{ sense: 0, formality: "neutral", ...example }], new Date(1000))
      const [first] = yield* examplesFor(db, [taberu])
      assert.strictEqual(first?.position, 0)

      // Examples written before voice casting carry no casting signals.
      assert.strictEqual(first?.casting, null)

      const clip = { key: "a".repeat(64), text: "食べる", language: "ja" as const, voiceId: "v", modelId: "m" }
      yield* saveAudio(db, { ...clip, voice: "ja-kyoko", characters: 3, bytes: 10, createdAt: new Date(1000) })
      yield* linkEntryAudio(db, taberu, clip.key)
      yield* linkExampleAudio(db, first!.id, "ja", clip.key, { castBy: "rules", score: 4 })
      assert.deepStrictEqual((yield* entryClips(db, [taberu])).get(taberu), [{ key: clip.key, voice: "ja-kyoko" }])
      assert.strictEqual((yield* exampleClips(db, [first!.id])).get(`${first!.id}:ja`), clip.key)
      assert.strictEqual(yield* audioCharactersSince(db, new Date(500)), 3)
      assert.strictEqual(yield* audioCharactersSince(db, new Date(1500)), 0)

      // A headword has one clip per dictionary voice; relinking the same clip is a no-op.
      const second = { ...clip, key: "b".repeat(64), voiceId: "w" }
      yield* saveAudio(db, { ...second, voice: null, characters: 3, bytes: 10, createdAt: new Date(1200) })
      yield* linkEntryAudio(db, taberu, second.key)
      yield* linkEntryAudio(db, taberu, clip.key)
      assert.deepStrictEqual(
        ((yield* entryClips(db, [taberu])).get(taberu) ?? []).map((row) => row.key),
        [clip.key, second.key]
      )

      // Casting signals round-trip when the writer provides them.
      yield* saveExamples(
        db,
        taberu,
        [
          {
            sense: 0,
            formality: "casual",
            ...example,
            casting: {
              speakerGender: "feminine",
              speakerAge: "youth",
              medium: "conversation",
              variety: "kansai",
              tone: "cheerful"
            }
          }
        ],
        new Date(1500)
      )
      const [cast] = yield* examplesFor(db, [taberu])
      assert.strictEqual(cast?.casting?.speakerGender, "feminine")
      assert.strictEqual(cast?.casting?.variety, "kansai")

      // A judgment fills only a sentence with no formality: Claude's own register stands.
      const judged = {
        formality: "formal" as const,
        casting: { speakerGender: "unspecified", speakerAge: "older", medium: null, variety: null, tone: null } as const
      }
      yield* saveCasting(db, [{ id: cast!.id, ...judged }])
      assert.strictEqual((yield* examplesFor(db, [taberu]))[0]?.formality, "casual")
      yield* saveExamples(db, taberu, [{ sense: 0, formality: null, ...example }], new Date(1600))
      const [unjudged] = yield* examplesFor(db, [taberu])
      yield* saveCasting(db, [{ id: unjudged!.id, ...judged }])
      const [filled] = yield* examplesFor(db, [taberu])
      assert.strictEqual(filled?.formality, "formal")
      assert.deepStrictEqual(filled?.casting, judged.casting)

      // Re-enriching replaces the examples; their audio links go with them.
      yield* saveExamples(db, taberu, [{ sense: 1, formality: "polite", ...example }], new Date(2000))
      const replaced = yield* examplesFor(db, [taberu])
      assert.strictEqual(replaced.length, 1)
      assert.strictEqual(replaced[0]?.sense, 1)
      assert.strictEqual((yield* exampleClips(db, [first!.id])).size, 0)
      assert.isTrue(Option.isSome(yield* findAudio(db, clip.key)))
    })
  )

  it.effect("keeps enrichment through a reseed, except for senses the entry lost", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const taberu = EntryId.make(1358280)
      // From the test above: nuance and a similar word on sense 0, an example on sense 1.
      yield* insertEntries(db, entries)
      assert.strictEqual((yield* nuanceFor(db, [taberu])).length, 1)
      assert.strictEqual((yield* similarFor(db, taberu)).length, 1)
      assert.strictEqual((yield* examplesFor(db, [taberu])).length, 1)
      const [reseeded] = yield* getEntries(db, [taberu])
      assert.strictEqual(reseeded?.senses[1]?.glosses.length, 2)

      yield* insertEntries(db, [{ ...entries[0]!, senses: [sense(["to eat", "to have a meal"])] }])
      assert.strictEqual((yield* nuanceFor(db, [taberu])).length, 1)
      assert.strictEqual((yield* examplesFor(db, [taberu])).length, 0)
      const [shrunk] = yield* getEntries(db, [taberu])
      assert.deepStrictEqual(
        shrunk?.senses.map((s) => s.glosses.map((gloss) => gloss.text)),
        [["to eat", "to have a meal"]]
      )
    })
  )
})
