import type { EntryId, Note, NoteId, PhraseNote, WordNote } from "@kotori/contracts"
import { describe, expect, it } from "vitest"
import { searchNotes } from "../src/lib/noteSearch.ts"

const note = (id: string, content: WordNote | PhraseNote): Note => ({
  id: id as NoteId,
  createdAt: new Date(0),
  content,
  cards: []
})

const word = (id: string, headword: string, reading: string, meaning: string, language?: "ja" | "en"): Note =>
  note(id, {
    kind: "word",
    entryId: 1 as EntryId,
    senseIndex: 0,
    ...(language === undefined ? {} : { language }),
    headword,
    reading,
    meaning,
    hint: null,
    note: null,
    example: null,
    audioUrl: null
  })

const phrase = (id: string, text: string, furigana: string | null, meaning: string): Note =>
  note(id, { kind: "phrase", text, furigana, meaning, note: null, register: null, source: "manual" })

const taberu = word("taberu", "食べる", "たべる", "to eat; to live on (e.g. a salary)")
const umbrella = word("kasa", "傘", "かさ", "umbrella; parasol")
const neko = word("neko", "猫", "ねこ", "cat")
const coffee = word("koohii", "コーヒー", "コーヒー", "coffee")
const thinIce = word("usugori", "薄氷を踏む", "はくひょうをふむ", "to skate on thin ice")
const late = phrase("late", "遅れてすみません", "{遅|おく}れてすみません", "Sorry I'm late")
const english = word("apple", "apple", "", "りんご、林檎", "en")

const notes = [taberu, umbrella, neko, coffee, thinIce, late, english]
const ids = (query: string) => searchNotes(notes, query).notes.map((found) => found.id)

describe("searchNotes", () => {
  it("returns every note, in order, for an empty query", () => {
    expect(searchNotes(notes, "  ")).toEqual({ match: "none", notes })
  })

  it("finds Japanese words as written, in kana, and inflected", () => {
    expect(ids("食べる")[0]).toBe("taberu")
    expect(ids("たべる")[0]).toBe("taberu")
    expect(ids("食べた")[0]).toBe("taberu")
    expect(ids("タベル")[0]).toBe("taberu")
    expect(ids("コーヒー")).toEqual(["koohii"])
    expect(searchNotes(notes, "食べた").match).toBe("exact")
  })

  it("reads rōmaji as kana", () => {
    expect(ids("taberu")).toEqual(["taberu"])
    expect(ids("tabemashita")).toEqual(["taberu"])
    expect(ids("neko")).toEqual(["neko"])
  })

  it("finds a word inside a phrase, and a phrase by its kana", () => {
    expect(ids("すみません")).toEqual(["late"])
    expect(ids("おくれて")).toEqual(["late"])
  })

  it("finds words by their meaning, inflected or with a pronoun", () => {
    expect(ids("eat")[0]).toBe("taberu")
    expect(ids("eating")[0]).toBe("taberu")
    expect(ids("parasol")).toEqual(["kasa"])
    expect(ids("sorry I am late")).toEqual(["late"])
  })

  it("finds English words and their Japanese meanings", () => {
    expect(ids("Apple")).toEqual(["apple"])
    expect(ids("りんご")).toEqual(["apple"])
  })

  it("falls back on a phrase with a word changed, then on typos, as lookalikes", () => {
    expect(ids("walk on thin ice")).toEqual(["usugori"])
    expect(searchNotes(notes, "walk on thin ice").match).toBe("weak")
    expect(ids("umbrela")).toEqual(["kasa"])
    expect(searchNotes(notes, "umbrela").match).toBe("weak")
  })

  it("finds nothing for what isn't saved", () => {
    expect(searchNotes(notes, "giraffe")).toEqual({ match: "none", notes: [] })
  })
})
