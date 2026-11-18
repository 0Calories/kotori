import type { EntryId } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { ApiError } from "../src/api/errors.ts"
import { strings } from "../src/i18n/strings.ts"
import { noteErrorText, noteMeaning, noteOn } from "../src/lib/notes.ts"
import { savedWord } from "./notes.fixtures.ts"

const taberu = savedWord("taberu", {
  entryId: 1358280,
  headword: "食べる",
  reading: "たべる",
  senses: [{ glosses: ["to eat"] }, { glosses: ["to live on", "to subsist on", "extra"] }, { glosses: ["to bite"] }]
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

  it("formats note glosses in each language", () => {
    assert.strictEqual(noteMeaning(taberu), "to eat / to live on; to subsist on / to bite")
    assert.strictEqual(noteMeaning(apple), "りんご、林檎／アップル")
  })

  it("maps offline vs server failures for saving and removing notes", () => {
    const t = strings.en
    const offline = new ApiError("Offline", "offline")
    const server = new ApiError("Unexpected", "boom")
    assert.strictEqual(noteErrorText(t, offline, "save"), t.common.offline)
    assert.strictEqual(noteErrorText(t, offline, "remove"), t.common.offline)
    assert.strictEqual(noteErrorText(t, server, "save"), t.notebook.saveFailed)
    assert.strictEqual(noteErrorText(t, server, "remove"), t.notebook.removeFailed)
  })
})
