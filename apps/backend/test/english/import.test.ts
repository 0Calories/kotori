import { afterAll, assert, layer } from "@effect/vitest"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { Effect, Layer, Option } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import * as EnglishDictionary from "../../src/features/dictionary/import/english/EnglishDictionary.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

const directory = mkdtempSync(join(tmpdir(), "english-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const file = (name: string, lines: ReadonlyArray<string>) => {
  const path = join(directory, name)
  writeFileSync(path, lines.join("\n"))
  return path
}

const line = (word: string, pos: string, glosses: Array<string>, extra: object = {}) =>
  JSON.stringify({ word, lang_code: "en", pos, senses: glosses.map((gloss) => ({ glosses: [gloss] })), ...extra })

const wiktionary = (withWalk: boolean) => [
  line("eat", "verb", ["～を食べる。"], { forms: [{ form: "eats", tags: ["third-person", "singular", "present"] }] }),
  line("ate", "verb", ["eatの過去形"]),
  line("May", "noun", ["5月"]),
  line("may", "verb", ["～かもしれない"]),
  ...(withWalk ? [line("walk", "verb", ["歩く。"])] : []),
  JSON.stringify({ word: "eat", lang_code: "de", pos: "verb", senses: [{ glosses: ["食べる。"] }] })
]

const jmdict = `<?xml version="1.0"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY exp "Expressions (phrases, clauses, etc.)">
<!ENTITY v5m "Godan verb with 'mu' ending">
<!ENTITY id "idiomatic expression">
]>
<JMdict>
<entry><ent_seq>1000010</ent_seq><k_ele><keb>自撮り</keb></k_ele><r_ele><reb>じどり</reb></r_ele><sense><pos>&n;</pos><gloss>selfie</gloss></sense></entry>
<entry><ent_seq>1000020</ent_seq><k_ele><keb>薄氷を踏む</keb></k_ele><r_ele><reb>はくひょうをふむ</reb></r_ele><sense><pos>&exp;</pos><pos>&v5m;</pos><misc>&id;</misc><gloss>to tread on thin ice</gloss><gloss>to walk on thin ice</gloss></sense></entry>
</JMdict>`

const files = (withWalk: boolean) => ({
  curated: file("curated.jsonl", [
    JSON.stringify({
      headword: "twerk",
      ipa: "/twɜɹk/",
      frequency: 3,
      inflections: [{ text: "twerking", tags: ["present-participle"] }],
      senses: [{ pos: ["v"], glosses: ["トゥワークする"] }]
    }),
    JSON.stringify({
      headword: "on thin ice",
      ipa: "/ɒn ˈθɪn ˈaɪs/",
      frequency: 5,
      spellings: ["skate on thin ice"],
      senses: [{ pos: ["exp"], misc: ["id"], glosses: ["薄氷を踏む", "危ない橋を渡る"] }]
    })
  ]),
  phrases: file("phrases.json", [
    JSON.stringify({ phrases: ["on thin ice"], redirects: { "skate on thin ice": "on thin ice" } })
  ]),
  wiktionary: file(`wiktionary-${withWalk}.jsonl`, wiktionary(withWalk)),
  subtitles: file("en_50k.txt", ["eat 5000", "ate 3000", "walk 2000", "may 4000", "selfie 900"])
})
const jmdictFile = file("JMdict.xml", [jmdict])

const TestLayer = Dictionary.layer.pipe(Layer.provideMerge(DatabaseMemory))

const kotoriEnglish: EntryRecord = {
  id: EntryId.make("kotori:delulu"),
  language: "en",
  source: "kotori",
  headword: "delulu",
  reading: "",
  common: false,
  priority: 10,
  forms: [
    { kind: "spelling", text: "delulu", common: false, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [
    {
      glosses: [{ text: "妄想的な", type: null }],
      pos: ["adj"],
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

layer(TestLayer)("EnglishDictionary.importFiles", (it) => {
  it.effect("assigns deterministic case-preserving en:<headword> IDs and keeps twins distinct", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      const result = yield* EnglishDictionary.importFiles({ files: files(true), jmdict: jmdictFile })
      assert.deepStrictEqual(result, { removed: 0, entries: 7, curated: 2, wiktionary: 4, jmdict: 1 })

      const eat = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:eat")))
      assert.strictEqual(eat.headword, "eat")
      const onThinIce = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:on thin ice")))
      assert.strictEqual(onThinIce.headword, "on thin ice")

      // Case-preserving twins have distinct IDs and both are discoverable from lowercase search.
      const lowerMay = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:may")))
      const upperMay = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:May")))
      assert.strictEqual(lowerMay.senses[0]?.glosses[0], "～かもしれない")
      assert.strictEqual(upperMay.senses[0]?.glosses[0], "5月")
      const maySearch = yield* dictionary.search("may", "en", 10)
      assert.includeMembers(
        maySearch.entries.map((e) => e.id),
        [EntryId.make("en:may"), EntryId.make("en:May")]
      )

      // Inflections ("ate") resolve to "en:eat".
      const ateSearch = yield* dictionary.search("ate", "en", 10)
      assert.strictEqual(ateSearch.entries[0]?.id, EntryId.make("en:eat"))
      assert.deepStrictEqual(ateSearch.entries[0]?.inflection, ["past"])
    })
  )

  it.effect("replaces only external en: rows on complete re-import while leaving kotori: entries untouched", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [kotoriEnglish])

      // A partial import never removes anything.
      assert.strictEqual(
        (yield* EnglishDictionary.importFiles({ files: files(false), jmdict: jmdictFile, limit: 1 })).removed,
        0
      )
      assert.isTrue(Option.isSome(yield* dictionary.entry(EntryId.make("en:walk"))))

      // Complete re-import removes stale external "en:walk" but keeps "kotori:delulu" and identical IDs.
      const result = yield* EnglishDictionary.importFiles({ files: files(false), jmdict: jmdictFile })
      assert.strictEqual(result.removed, 1)
      assert.isTrue(Option.isNone(yield* dictionary.entry(EntryId.make("en:walk"))))
      assert.isTrue(Option.isSome(yield* dictionary.entry(EntryId.make("en:eat"))))
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(EntryId.make("kotori:delulu"))).headword, "delulu")
    })
  )
})
