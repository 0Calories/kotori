import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { Effect, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { audioCharactersSince, findAudio, formClips, saveAudio } from "../../src/features/audio/queries.ts"
import { entriesByPriority, getEntries, insertEntries } from "../../src/features/dictionary/queries.ts"
import { examplesFor, saveExamples } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries, sense } from "../fixtures.ts"

const TestLayer = DatabaseMemory

layer(TestLayer)("enrichment queries", (it) => {
  it.effect(
    "stores examples per sense, resolves content-addressed form audio, and replaces examples on re-enrichment",
    () =>
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
        assert.strictEqual(first?.casting, null)

        // Spoken form audio resolves directly from content-addressed `audio` by (language, reading) with no join table.
        const clip = { key: "a".repeat(64), text: "たべる", language: "ja" as const, voiceId: "v", modelId: "m" }
        yield* saveAudio(db, { ...clip, voice: "ja-kyoko", characters: 3, bytes: 10, createdAt: new Date(1000) })
        const [taberuRecord] = yield* getEntries(db, [taberu])
        assert.deepStrictEqual((yield* formClips(db, [taberuRecord!])).get(taberu), [
          { key: clip.key, voice: "ja-kyoko" }
        ])
        assert.strictEqual(yield* audioCharactersSince(db, new Date(500)), 3)
        assert.strictEqual(yield* audioCharactersSince(db, new Date(1500)), 0)
        // Once its spoken form is in `audio`, it is no longer missing audio.
        assert.deepStrictEqual(yield* entriesByPriority(db, { limit: 1, missing: "audio" }), [1269130])

        // A headword resolves clips across dictionary voices in deterministic cast order, with legacy clips after.
        const second = { ...clip, key: "b".repeat(64), voiceId: "w" }
        yield* saveAudio(db, { ...second, voice: null, characters: 3, bytes: 10, createdAt: new Date(1200) })
        assert.deepStrictEqual(
          ((yield* formClips(db, [taberuRecord!])).get(taberu) ?? []).map((row) => row.key),
          [clip.key, second.key]
        )

        // Re-enriching replaces the examples without touching content-addressed audio.
        yield* saveExamples(db, taberu, [{ sense: 1, formality: "polite", ...example }], new Date(2000))
        const replaced = yield* examplesFor(db, [taberu])
        assert.strictEqual(replaced.length, 1)
        assert.strictEqual(replaced[0]?.sense, 1)
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
