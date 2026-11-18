import type { EntryId } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { glossLine, noteMeaning, noteOn } from "../src/lib/notes.ts"
import { savedWord } from "./notes.fixtures.ts"

const taberu = savedWord("taberu", {
  entryId: 1358280,
  headword: "食べる",
  reading: "たべる",
  senses: [{ glosses: ["to eat"] }, { glosses: ["to live on", "to subsist on"] }, { glosses: ["to bite"] }]
})

const apple = savedWord("apple", {
  entryId: 100000001,
  headword: "apple",
  reading: "/ˈæp.əl/",
  language: "en",
  senses: [{ glosses: ["りんご", "林檎"] }, { glosses: ["アップル"] }]
})

describe("notebook helpers", () => {
  it("finds a learner's saved note on an entry", () => {
    assert.strictEqual(noteOn([taberu, apple], 1358280 as EntryId), taberu)
    assert.strictEqual(noteOn([taberu, apple], 999 as EntryId), undefined)
    assert.strictEqual(noteOn(undefined, 1358280 as EntryId), undefined)
  })

  it("formats glosses and note meanings in each language", () => {
    assert.strictEqual(glossLine("ja", ["to eat", "to dine", "to consume", "extra"]), "to eat; to dine; to consume")
    assert.strictEqual(glossLine("en", ["りんご", "林檎"]), "りんご、林檎")
    assert.strictEqual(noteMeaning(taberu), "to eat / to live on; to subsist on / to bite")
    assert.strictEqual(noteMeaning(apple), "りんご、林檎／アップル")
  })
})
