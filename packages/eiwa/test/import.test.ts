import { afterAll, assert, layer } from "@effect/vitest"
import { DictionaryRepo, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Effect, Layer } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Eiwa } from "../src/index.ts"

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
]>
<JMdict>
<entry><ent_seq>1000010</ent_seq><k_ele><keb>自撮り</keb></k_ele><r_ele><reb>じどり</reb></r_ele><sense><pos>&n;</pos><gloss>selfie</gloss></sense></entry>
</JMdict>`

const files = (withWalk: boolean) => ({
  wiktionary: file(`wiktionary-${withWalk}.jsonl`, wiktionary(withWalk)),
  ejdict: file("ejdict.txt", ["team\t『チーム』", "eat\t…を『食べる』"]),
  frequency: file("en_50k.txt", ["eat 5000", "ate 3000", "team 4000", "walk 2000", "selfie 900"])
})
const jmdictFile = file("JMdict.xml", [jmdict])

const TestLayer = Repositories.pipe(Layer.provideMerge(DatabaseMemory))

layer(TestLayer)("Eiwa.importFiles", (it) => {
  it.effect("loads each word from the first source that has it, next to JMDict's", () =>
    Effect.gen(function* () {
      const result = yield* Eiwa.importFiles({ files: files(true), jmdict: jmdictFile })
      assert.deepStrictEqual(result, { removed: 0, entries: 4, wiktionary: 2, ejdict: 1, jmdict: 1 })

      const repo = yield* DictionaryRepo
      const ids = yield* repo.headwordIds("en")
      assert.sameMembers([...ids.keys()], ["eat", "walk", "team", "selfie"])
      // "ate" is eat's past, found through it.
      const [ate] = yield* repo.findForms(["ate"], "en")
      assert.deepStrictEqual([ate?.entryId, ate?.kind, ate?.tags], [ids.get("eat"), "inflection", ["past"]])
      const [selfie] = yield* repo.getEntries([ids.get("selfie")!])
      assert.deepStrictEqual(
        selfie?.senses.map((sense) => sense.glosses[0]?.text),
        ["自撮り"]
      )
      assert.strictEqual((yield* repo.tags).get("en-GB"), "British English")
    })
  )

  it.effect("keeps ids on a re-import and removes words the sources no longer have", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const before = yield* repo.headwordIds("en")

      // A partial import never removes anything.
      assert.strictEqual((yield* Eiwa.importFiles({ files: files(false), jmdict: jmdictFile, limit: 1 })).removed, 0)
      assert.strictEqual((yield* repo.headwordIds("en")).size, 4)

      const result = yield* Eiwa.importFiles({ files: files(false), jmdict: jmdictFile })
      assert.strictEqual(result.removed, 1)
      const after = yield* repo.headwordIds("en")
      assert.isFalse(after.has("walk"))
      for (const [headword, id] of after) assert.strictEqual(id, before.get(headword))
    })
  )
})
