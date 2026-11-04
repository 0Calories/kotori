import { afterAll, assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import * as Eiwa from "../../src/features/dictionary/import/eiwa/Eiwa.ts"
import { findForms, getEntries, headwordIds, tagLabels } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

// The importer streams its sources from disk, so the fixtures are real files.
const directory = mkdtempSync(join(tmpdir(), "eiwa-"))
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
      familiarity: 3,
      inflections: [{ text: "twerking", tags: ["present-participle"] }],
      senses: [{ pos: ["v"], glosses: ["トゥワークする"] }]
    }),
    JSON.stringify({
      headword: "on thin ice",
      ipa: "/ɒn ˈθɪn ˈaɪs/",
      familiarity: 5,
      spellings: ["skate on thin ice"],
      senses: [{ pos: ["exp"], misc: ["id"], glosses: ["薄氷を踏む", "危ない橋を渡る"] }]
    })
  ]),
  phrases: file("phrases.json", [
    JSON.stringify({ phrases: ["on thin ice"], redirects: { "skate on thin ice": "on thin ice" } })
  ]),
  wiktionary: file(`wiktionary-${withWalk}.jsonl`, wiktionary(withWalk)),
  frequency: file("en_50k.txt", ["eat 5000", "ate 3000", "walk 2000", "selfie 900"])
})
const jmdictFile = file("JMdict.xml", [jmdict])

const TestLayer = DatabaseMemory

layer(TestLayer)("Eiwa.importFiles", (it) => {
  it.effect("loads each word from the first source that has it, next to JMDict's", () =>
    Effect.gen(function* () {
      const result = yield* Eiwa.importFiles({ files: files(true), jmdict: jmdictFile })
      assert.deepStrictEqual(result, { removed: 0, entries: 5, curated: 2, wiktionary: 2, jmdict: 1 })

      const db = yield* Database
      const ids = yield* headwordIds(db, "en")
      assert.sameMembers([...ids.keys()], ["twerk", "on thin ice", "eat", "walk", "selfie"])
      // "ate" is eat's past, found through it.
      const [ate] = yield* findForms(db, ["ate"], "en")
      assert.deepStrictEqual([ate?.entryId, ate?.kind, ate?.tags], [ids.get("eat"), "inflection", ["past"]])
      const [walkOnThinIce] = yield* findForms(db, ["walk on thin ice"], "en")
      assert.strictEqual(walkOnThinIce?.entryId, ids.get("on thin ice"))
      const [selfie] = yield* getEntries(db, [ids.get("selfie")!])
      assert.deepStrictEqual(
        selfie?.senses.map((sense) => sense.glosses[0]?.text),
        ["自撮り"]
      )
      assert.strictEqual((yield* tagLabels(db)).get("en-GB"), "British English")
    })
  )

  it.effect("imports approved Ask Kotori entries and aliases alongside the sources", () =>
    Effect.gen(function* () {
      const approved = file("approved.jsonl", [
        JSON.stringify({
          entry: {
            headword: "rizzler",
            ipa: "/ˈɹɪzlɚ/",
            familiarity: 4,
            senses: [{ pos: ["n"], misc: ["sl"], glosses: ["モテる人"] }]
          }
        }),
        JSON.stringify({ alias: { text: "walking on thin ice", base: "on thin ice" } })
      ])
      const result = yield* Eiwa.importFiles({ files: { ...files(true), approved }, jmdict: jmdictFile })
      assert.strictEqual(result.curated, 3)

      const db = yield* Database
      const ids = yield* headwordIds(db, "en")
      const [rizzler] = yield* findForms(db, ["rizzler"], "en")
      assert.strictEqual(rizzler?.entryId, ids.get("rizzler"))
      const [walking] = yield* findForms(db, ["walking on thin ice"], "en")
      assert.strictEqual(walking?.entryId, ids.get("on thin ice"))

      // Without the approved file, its words go the way of any removed source word.
      const without = yield* Eiwa.importFiles({ files: files(true), jmdict: jmdictFile })
      assert.strictEqual(without.removed, 1)
    })
  )

  it.effect("keeps ids on a re-import and removes words the sources no longer have", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const before = yield* headwordIds(db, "en")

      // A partial import never removes anything.
      assert.strictEqual((yield* Eiwa.importFiles({ files: files(false), jmdict: jmdictFile, limit: 1 })).removed, 0)
      assert.strictEqual((yield* headwordIds(db, "en")).size, 5)

      const result = yield* Eiwa.importFiles({ files: files(false), jmdict: jmdictFile })
      assert.strictEqual(result.removed, 1)
      const after = yield* headwordIds(db, "en")
      assert.isFalse(after.has("walk"))
      for (const [headword, id] of after) assert.strictEqual(id, before.get(headword))
    })
  )
})
