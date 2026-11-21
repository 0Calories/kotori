import type { EntryId, Note, NoteId } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { ApiError } from "../src/api/errors.ts"
import { strings } from "../src/i18n/strings.ts"
import { noteErrorText, noteGlosses, noteOn } from "../src/lib/notes.ts"

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: "note-1" as NoteId,
  createdAt: new Date(0),
  entry: {
    id: "jmdict:1" as EntryId,
    language: "ja",
    source: "jmdict",
    reviewState: "approved",
    headword: "食べる",
    reading: "たべる"
  },
  senses: [{ glosses: ["to eat", "to dine", "to consume"] }, { glosses: ["to live on"] }],
  ...overrides
})

describe("notes helpers", () => {
  it("finds a note by entry id", () => {
    const note = makeNote()
    assert.strictEqual(noteOn([note], "jmdict:1" as EntryId), note)
    assert.strictEqual(noteOn([note], "jmdict:2" as EntryId), undefined)
    assert.strictEqual(noteOn(undefined, "jmdict:1" as EntryId), undefined)
  })

  it("joins the first two glosses of each sense with language-appropriate punctuation", () => {
    assert.strictEqual(noteGlosses(makeNote()), "to eat; to dine / to live on")
    assert.strictEqual(
      noteGlosses(
        makeNote({
          entry: {
            id: "en:eat" as EntryId,
            language: "en",
            source: "enwiktionary",
            reviewState: "approved",
            headword: "eat",
            reading: "/iːt/"
          },
          senses: [{ glosses: ["食べる", "食事をする", "口にする"] }, { glosses: ["悩ます"] }]
        })
      ),
      "食べる、食事をする／悩ます"
    )
  })

  it("maps offline and server errors for save and remove actions", () => {
    const offline = new ApiError("Offline", "offline")
    const server = new ApiError("Unexpected", "boom")
    assert.strictEqual(noteErrorText(strings.en, offline, "save"), strings.en.common.offline)
    assert.strictEqual(noteErrorText(strings.en, offline, "remove"), strings.en.common.offline)
    assert.strictEqual(noteErrorText(strings.en, server, "save"), strings.en.notebook.saveFailed)
    assert.strictEqual(noteErrorText(strings.en, server, "remove"), strings.en.notebook.removeFailed)
  })
})
