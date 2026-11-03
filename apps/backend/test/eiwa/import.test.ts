import { afterAll, assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import * as Eiwa from "../../src/features/dictionary/import/eiwa/Eiwa.ts"
import { findForms, getEntries, headwordIds, tagLabels } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

const directory = mkdtempSync(join(tmpdir(), "eiwa-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const file = (name: string, lines: ReadonlyArray<string>) => {
  const path = join(directory, name)
  writeFileSync(path, lines.join("\n"))
  return path
}

const consolidatedLine = (
  headword: string,
  pos: string,
  glosses: Array<string>,
  extra: object = {}
) =>
  JSON.stringify({
    headword,
    ipa: null,
    familiarity: 4,
    senses: [{ pos: [pos], glosses }],
    ...extra
  })

const wiktionary = (withWalk: boolean) => [
  consolidatedLine("eat", "v", ["～を食べる"], {
    ipa: "/iːt/",
    inflections: [
      { text: "eats", tags: ["third-person"] },
      { text: "ate", tags: ["past"] }
    ]
  }),
  ...(withWalk ? [consolidatedLine("walk", "v", ["歩く"])] : []),
  consolidatedLine("keep it real", "v", ["ありのままでいる", "本音で話す"], {
    ipa: "/ˈkiːp ɪt ˈɹiːl/",
    inflections: [{ text: "kept it real", tags: ["past", "past-participle"] }]
  })
]

const files = (withWalk: boolean) => ({
  wiktionary: file(`wiktionary-${withWalk}.jsonl`, wiktionary(withWalk)),
  frequency: file("en_50k.txt", ["eat 5000", "ate 3000", "walk 2000"])
})

const TestLayer = DatabaseMemory

layer(TestLayer)("Eiwa.importFiles", (it) => {
  it.effect("loads consolidated enwiktionary entries and their inflections into the database", () =>
    Effect.gen(function* () {
      const result = yield* Eiwa.importFiles({ files: files(true) })
      assert.deepStrictEqual(result, { removed: 0, entries: 3 })

      const db = yield* Database
      const ids = yield* headwordIds(db, "en")
      assert.sameMembers([...ids.keys()], ["eat", "walk", "keep it real"])

      const [ate] = yield* findForms(db, ["ate"], "en")
      assert.deepStrictEqual([ate?.entryId, ate?.kind, ate?.tags], [ids.get("eat"), "inflection", ["past"]])

      const [keptItReal] = yield* findForms(db, ["kept it real"], "en")
      assert.deepStrictEqual(
        [keptItReal?.entryId, keptItReal?.kind, keptItReal?.tags],
        [ids.get("keep it real"), "inflection", ["past", "past-participle"]]
      )

      const [keepItReal] = yield* getEntries(db, [ids.get("keep it real")!])
      assert.deepStrictEqual(
        keepItReal?.senses.map((sense) => sense.glosses.map((g) => g.text)),
        [["ありのままでいる", "本音で話す"]]
      )
      assert.strictEqual((yield* tagLabels(db)).get("en-GB"), "British English")
    })
  )

  it.effect("keeps ids on a re-import and removes words the source no longer has", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const before = yield* headwordIds(db, "en")

      // A partial import never removes anything.
      assert.strictEqual((yield* Eiwa.importFiles({ files: files(false), limit: 1 })).removed, 0)
      assert.strictEqual((yield* headwordIds(db, "en")).size, 3)

      const result = yield* Eiwa.importFiles({ files: files(false) })
      assert.strictEqual(result.removed, 1)
      const after = yield* headwordIds(db, "en")
      assert.isFalse(after.has("walk"))
      for (const [headword, id] of after) assert.strictEqual(id, before.get(headword))
    })
  )
})
