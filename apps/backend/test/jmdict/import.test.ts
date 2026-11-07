import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { labels } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Effect, FileSystem, Layer } from "effect"
import { Database } from "../../src/db/Database.ts"
import * as JMDict from "../../src/features/dictionary/import/jmdict/JMDict.ts"
import { entryCount, getEntries, tagLabels } from "../../src/features/dictionary/queries.ts"
import { enqueueJob, jobStatusFor } from "../../src/features/enrichment/jobs.ts"
import { examplesFor, saveExamples } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

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

const TestLayer = Layer.mergeAll(Files).pipe(Layer.provideMerge(DatabaseMemory))

const taberu = EntryId.make(1358280)
/** Kotori's labels on the word's senses: enrichment the import keeps, following its sense. */
const kotoriLabel = (sense: number) => ({ entryId: taberu, sense, code: "form" as const, source: "kotori" as const })
const labelledSenses = Effect.gen(function* () {
  const db = yield* Database
  const rows = yield* db.select().from(labels).where(eq(labels.entryId, taberu))
  return rows.flatMap((row) => (row.source === "kotori" ? [row.sense] : [])).sort((a, b) => a - b)
})

// Dictionary and enrichment are rebuildable, so moving to a new JMDict release is a reseed:
// the seeder upserts, and enrichment for senses that still exist must survive it.
layer(TestLayer)("JMDict.importFile", (it) => {
  it.effect("seeding twice leaves the same dictionary, enrichment and queue", () =>
    Effect.gen(function* () {
      const db = yield* Database

      assert.deepStrictEqual(yield* JMDict.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      const seeded = yield* getEntries(db, [taberu, EntryId.make(1001720)])
      assert.strictEqual(seeded[0]?.senses[1]?.glosses[1]?.type, "fig")

      yield* db.insert(labels).values([kotoriLabel(0), kotoriLabel(1)])
      yield* saveExamples(
        db,
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
        new Date(1000)
      )
      yield* enqueueJob(db, "audio", taberu, 10, new Date(1000))

      assert.deepStrictEqual(yield* JMDict.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      assert.strictEqual(yield* entryCount(db), 2)
      assert.deepStrictEqual(yield* getEntries(db, [taberu, EntryId.make(1001720)]), seeded)
      assert.strictEqual((yield* tagLabels(db)).size, 3)
      assert.deepStrictEqual(yield* labelledSenses, [0, 1])
      assert.strictEqual((yield* examplesFor(db, [taberu])).length, 1)
      assert.strictEqual((yield* jobStatusFor(db, taberu)).get("audio"), "queued")
    })
  )

  it.effect("a newer release updates in place and drops only the enrichment of senses it lost", () =>
    Effect.gen(function* () {
      const db = yield* Database
      current = release("<sense><pos>&v1;</pos><gloss>to eat</gloss><gloss>to have a meal</gloss></sense>", "honorific")

      yield* JMDict.importFile({ file: "JMdict_e.gz" })
      const [updated] = yield* getEntries(db, [taberu])
      assert.deepStrictEqual(
        updated?.senses.map((sense) => sense.glosses.map((gloss) => gloss.text)),
        [["to eat", "to have a meal"]]
      )
      assert.strictEqual((yield* tagLabels(db)).get("hon"), "honorific")
      assert.deepStrictEqual(yield* labelledSenses, [0])
      assert.strictEqual((yield* examplesFor(db, [taberu])).length, 0)
      assert.strictEqual(yield* entryCount(db), 2)
    })
  )
})
