import { assert, layer } from "@effect/vitest"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { Effect, FileSystem, Layer, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import * as JMDict from "../../src/features/dictionary/import/jmdict/JMDict.ts"
import { entryCount, insertEntries } from "../../src/features/dictionary/queries.ts"
import { saveExamples } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

const release = (
  taberuSenses: string,
  honLabel = "honorific or respectful (sonkeigo) language",
  includeOkashi = true
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
</entry>${
  includeOkashi
    ? `
<entry>
<ent_seq>1001720</ent_seq>
<k_ele><keb>お菓子</keb></k_ele>
<r_ele><reb>おかし</reb></r_ele>
<sense><pos>&n;</pos><gloss>confections</gloss><gloss>sweets</gloss></sense>
</entry>`
    : ""
}
</JMdict>`

const twoSenses =
  "<sense><pos>&v1;</pos><gloss>to eat</gloss></sense>" +
  '<sense><gloss>to live on (e.g. a salary)</gloss><gloss g_type="fig">to subsist on</gloss></sense>'

let current = release(twoSenses)
const Files = FileSystem.layerNoop({ readFile: () => Effect.sync(() => new TextEncoder().encode(current)) })

const TestLayer = Layer.mergeAll(Dictionary.layer, Files).pipe(Layer.provideMerge(DatabaseMemory))

const taberu = EntryId.make("jmdict:1358280")
const okashi = EntryId.make("jmdict:1001720")
const kotoriSlang = EntryId.make("kotori:kaeruka")

const kotoriEntry: EntryRecord = {
  id: kotoriSlang,
  language: "ja",
  source: "kotori",
  headword: "蛙化現象",
  reading: "かえるかげんしょう",
  common: false,
  priority: 10,
  forms: [
    { kind: "kanji", text: "蛙化現象", common: false, tags: [], priorities: [], restrictions: [], noKanji: false },
    {
      kind: "kana",
      text: "かえるかげんしょう",
      common: false,
      tags: [],
      priorities: [],
      restrictions: [],
      noKanji: false
    }
  ],
  senses: [
    {
      glosses: [{ text: "the ick", type: null }],
      pos: ["n"],
      misc: ["sl"],
      fields: [],
      dialects: [],
      info: [],
      stagk: [],
      stagr: [],
      xrefs: [],
      antonyms: [],
      origins: [],
      wasei: false
    }
  ]
}

layer(TestLayer)("JMDict.importFile", (it) => {
  it.effect("imports deterministic jmdict:<seq> IDs and is idempotent across re-imports", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary

      assert.deepStrictEqual(yield* JMDict.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      const first = Option.getOrThrow(yield* dictionary.entry(taberu))
      assert.strictEqual(first.id, taberu)
      assert.strictEqual(first.headword, "食べる")
      assert.strictEqual(first.reading, "たべる")
      assert.deepStrictEqual(
        first.senses.map((s) => s.glosses),
        [["to eat"], ["to live on (e.g. a salary)", "to subsist on"]]
      )

      // Search finds imported entries immediately via entry_search.
      const search = yield* dictionary.search("食べる", "ja", 10)
      assert.strictEqual(search.entries[0]?.id, taberu)

      // Manual enrichment survives an identical re-import.
      yield* saveExamples(
        db,
        taberu,
        [
          {
            sense: 0,
            ja: "パンを食べる。",
            furigana: "パンを食べる。",
            en: "I eat bread.",
            formality: "neutral",
            note: null,
            model: "test"
          }
        ],
        new Date(1000)
      )

      assert.deepStrictEqual(yield* JMDict.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      assert.strictEqual(yield* entryCount(db), 2)
      const reimported = Option.getOrThrow(yield* dictionary.entry(taberu))
      assert.strictEqual(reimported.senses[0]?.examples.length, 1)
    })
  )

  it.effect("replaces only external jmdict: rows on complete re-import while leaving kotori: rows untouched", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [kotoriEntry])

      current = release(
        "<sense><pos>&v1;</pos><gloss>to eat</gloss><gloss>to have a meal</gloss></sense>",
        "honorific",
        false
      )

      yield* JMDict.importFile({ file: "JMdict_e.gz" })

      const updated = Option.getOrThrow(yield* dictionary.entry(taberu))
      assert.deepStrictEqual(
        updated.senses.map((s) => s.glosses),
        [["to eat", "to have a meal"]]
      )
      // Stale jmdict: entry removed on complete re-import.
      assert.isTrue(Option.isNone(yield* dictionary.entry(okashi)))
      // kotori: entry is completely untouched.
      const kept = Option.getOrThrow(yield* dictionary.entry(kotoriSlang))
      assert.strictEqual(kept.headword, "蛙化現象")
      assert.strictEqual(yield* entryCount(db), 2)
    })
  )
})
