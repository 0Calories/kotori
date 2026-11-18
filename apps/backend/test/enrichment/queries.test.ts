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
import { examplesFor, saveCasting, saveExamples } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries, sense } from "../fixtures.ts"

const TestLayer = DatabaseMemory

layer(TestLayer)("enrichment queries", (it) => {
  it.effect("stores examples and audio per sense and replaces them on re-enrichment", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, entries)
      const taberu = EntryId.make(1358280)
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
      // A word with Kotori's sentences is no longer missing them.
      assert.deepStrictEqual(yield* entriesByPriority(db, { limit: 1, missing: "examples" }), [1269130])

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
      // From the test above: an example on sense 1.
      yield* insertEntries(db, entries)
      assert.strictEqual((yield* examplesFor(db, [taberu])).length, 1)
      const [reseeded] = yield* getEntries(db, [taberu])
      assert.strictEqual(reseeded?.senses[1]?.glosses.length, 2)

      yield* insertEntries(db, [{ ...entries[0]!, senses: [sense(["to eat", "to have a meal"])] }])
      assert.strictEqual((yield* examplesFor(db, [taberu])).length, 0)
      const [shrunk] = yield* getEntries(db, [taberu])
      assert.deepStrictEqual(
        shrunk?.senses.map((s) => s.glosses.map((gloss) => gloss.text)),
        [["to eat", "to have a meal"]]
      )
    })
  )
})
