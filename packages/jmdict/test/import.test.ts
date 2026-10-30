import { assert, layer } from "@effect/vitest"
import { DictionaryRepo, EnrichmentRepo, JobsRepo, type NuanceInput, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Effect, FileSystem, Layer } from "effect"
import { JMDict } from "../src/index.ts"

const release = (
  taberuSenses: string,
  honLabel = "honorific or respectful (sonkeigo) language"
) => `<?xml version="1.0"?>
<!DOCTYPE JMdict [
<!ENTITY v1 "Ichidan verb">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY hon "${honLabel}">
]>
<JMdict>
<entry>
<ent_seq>1358280</ent_seq>
<k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
${taberuSenses}
</entry>
<entry>
<ent_seq>1001720</ent_seq>
<k_ele><keb>お菓子</keb></k_ele>
<r_ele><reb>おかし</reb></r_ele>
<sense><pos>&n;</pos><gloss>confections</gloss><gloss>sweets</gloss></sense>
</entry>
</JMdict>`

const twoSenses =
  "<sense><pos>&v1;</pos><gloss>to eat</gloss></sense>" +
  '<sense><gloss>to live on (e.g. a salary)</gloss><gloss g_type="fig">to subsist on</gloss></sense>'

// The seeder reads whatever JMDict file it is given; here the "file" is whichever release is current.
let current = release(twoSenses)
const Files = FileSystem.layerNoop({ readFile: () => Effect.sync(() => new TextEncoder().encode(current)) })

const TestLayer = Layer.mergeAll(Repositories, Files).pipe(Layer.provideMerge(DatabaseMemory))

const taberu = 1358280
const judgment = { value: "neutral" as const, confidence: 0.9, source: "jev" as const }
const nuance = (sense: number): NuanceInput => ({
  sense,
  nuance: {
    formality: { value: "neutral", position: 0.5, confidence: 0.9, source: "jev" },
    medium: { value: "both", position: 0.5, confidence: 0.8, source: "jev" },
    keigo: { ...judgment, value: "none" },
    gender: judgment,
    age: { ...judgment, value: "any" },
    currency: { ...judgment, value: "current" },
    connotation: judgment,
    cautions: { rudeToSuperiors: 0.1, stiffWithFriends: 0.1, slang: 0.05 }
  },
  answers: {},
  model: "jev-test",
  questionsVersion: 1
})

// Dictionary and enrichment are rebuildable, so moving to a new JMDict release is a reseed:
// the seeder upserts, and enrichment for senses that still exist must survive it.
layer(TestLayer)("JMDict.importFile", (it) => {
  it.effect("seeding twice leaves the same dictionary, enrichment and queue", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo

      assert.deepStrictEqual(yield* JMDict.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      const seeded = yield* dictionary.getEntries([taberu, 1001720])
      assert.strictEqual(seeded[0]?.senses[1]?.glosses[1]?.type, "fig")

      yield* enrichment.saveNuance(taberu, [nuance(0), nuance(1)], 1000)
      yield* enrichment.saveExamples(
        taberu,
        [
          {
            sense: 1,
            ja: "給料で食べる。",
            furigana: "",
            en: "Live on a salary.",
            formality: "neutral",
            note: null,
            model: "m"
          }
        ],
        1000
      )
      yield* jobs.enqueue("audio", taberu, 10, 1000)

      assert.deepStrictEqual(yield* JMDict.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      assert.strictEqual(yield* dictionary.count, 2)
      assert.deepStrictEqual(yield* dictionary.getEntries([taberu, 1001720]), seeded)
      assert.strictEqual((yield* dictionary.tags).size, 3)
      assert.deepStrictEqual(
        (yield* enrichment.nuanceFor([taberu])).map((row) => row.sense).sort((a, b) => a - b),
        [0, 1]
      )
      assert.strictEqual((yield* enrichment.examplesFor([taberu])).length, 1)
      assert.strictEqual((yield* jobs.statusFor(taberu)).get("audio"), "queued")
    })
  )

  it.effect("a newer release updates in place and drops only the enrichment of senses it lost", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      current = release("<sense><pos>&v1;</pos><gloss>to eat</gloss><gloss>to have a meal</gloss></sense>", "honorific")

      yield* JMDict.importFile({ file: "JMdict_e.gz" })
      const [updated] = yield* dictionary.getEntries([taberu])
      assert.deepStrictEqual(
        updated?.senses.map((sense) => sense.glosses.map((gloss) => gloss.text)),
        [["to eat", "to have a meal"]]
      )
      assert.strictEqual((yield* dictionary.tags).get("hon"), "honorific")
      assert.deepStrictEqual(
        (yield* enrichment.nuanceFor([taberu])).map((row) => row.sense),
        [0]
      )
      assert.strictEqual((yield* enrichment.examplesFor([taberu])).length, 0)
      assert.strictEqual(yield* dictionary.count, 2)
    })
  )
})
