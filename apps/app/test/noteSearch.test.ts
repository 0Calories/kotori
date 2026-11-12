import type { EntryId, Note, NoteId, PhraseNote, WordNote } from "@kotori/contracts"
import { describe, expect, it } from "vitest"
import { searchNotes, searchNotesByKind } from "../src/lib/noteSearch.ts"

const note = (id: string, content: WordNote | PhraseNote): Note => ({
  id: id as NoteId,
  createdAt: new Date(0),
  content,
  retentionStage: "new",
  due: new Date(0),
  interval: 0,
  ease: 0,
  reps: 0,
  lapses: 0,
  leech: false
})

const word = (
  id: string,
  headword: string,
  reading: string,
  meaning: string,
  language?: "ja" | "en",
  usageNote: string | null = null
): Note =>
  note(id, {
    kind: "word",
    entryId: 1 as EntryId,
    senseIndex: 0,
    ...(language === undefined ? {} : { language }),
    headword,
    reading,
    meaning,
    hint: null,
    note: usageNote,
    example: null,
    audioUrl: null
  })

const phrase = (
  id: string,
  text: string,
  furigana: string | null,
  meaning: string,
  usageNote: string | null = null
): Note => note(id, { kind: "phrase", text, furigana, meaning, note: usageNote, register: null, source: "manual" })

const taberu = word("taberu", "食べる", "たべる", "to eat; to live on (e.g. a salary)")
const umbrella = word("kasa", "傘", "かさ", "umbrella; parasol")
const neko = word("neko", "猫", "ねこ", "cat")
const coffee = word("koohii", "コーヒー", "コーヒー", "coffee")
const thinIce = word("usugori", "薄氷を踏む", "はくひょうをふむ", "to skate on thin ice")
const late = phrase("late", "遅れてすみません", "{遅|おく}れてすみません", "Sorry I'm late")
const english = word("apple", "apple", "/ˈæp.əl/", "りんご、林檎", "en")

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

  it("reads rōmaji as kana, without letting rōmaji guesses outrank strong English matches", () => {
    expect(ids("taberu")).toEqual(["taberu"])
    expect(ids("tabemashita")).toEqual(["taberu"])
    expect(ids("neko")).toEqual(["neko"])

    const matsu = word("matsu", "待つ", "まつ", "to wait")
    const nakama = word("nakama", "仲間", "なかま", "mate; colleague")
    const toru = word("toru", "取る", "とる", "to take")
    const take = word("take", "竹", "たけ", "bamboo")
    const taku = word("taku", "炊く", "たく", "to cook rice")
    expect(searchNotes([matsu, nakama], "mate").notes.map((n) => n.id)).toEqual(["nakama"])
    expect(searchNotes([taku, take, toru], "take").notes.map((n) => n.id)).toEqual(["toru", "take"])
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

  it("ranks whole-word and placeholder matches in English forms above prefixes", () => {
    const walkAway = phrase("walk-away", "walk away", null, "立ち去る")
    const neverWalk = phrase("never-walk", "never walk away", null, "決して立ち去らない")
    const walkabout = word("walkabout", "walkabout", "/ˈwɔːk.ə.baʊt/", "徒歩の旅", "en")
    const tellSomeone = phrase("tell-sb", "tell someone", null, "誰かに話す")

    expect(searchNotes([walkabout, neverWalk, walkAway], "walk").notes.map((n) => n.id)).toEqual([
      "walk-away",
      "never-walk",
      "walkabout"
    ])
    expect(searchNotes([tellSomeone], "tell")).toEqual({ match: "exact", notes: [tellSomeone] })
  })

  it("finds English words and their Japanese meanings in hiragana or katakana, ignoring IPA readings", () => {
    expect(ids("Apple")).toEqual(["apple"])
    expect(ids("りんご")).toEqual(["apple"])
    expect(ids("リンゴ")).toEqual(["apple"])
    expect(ids("リン")).toEqual(["apple"])

    const readPast = word("read", "read", "/rɛd/", "読む", "en")
    expect(searchNotes([readPast], "red").notes).toEqual([])
  })

  it("searches English meanings and usage notes even when they quote Japanese", () => {
    const withParticle = word(
      "au",
      "会う",
      "あう",
      "to meet (e.g. 友達に)",
      "ja",
      "Used with に to mark the person met."
    )
    const politePhrase = phrase(
      "otsukare",
      "お疲れ様です",
      "お{疲|つか}れ{様|さま}です",
      "Polite way to say お疲れ",
      "Warmer than ありがとう among coworkers."
    )
    expect(searchNotes([withParticle], "person met").notes.map((n) => n.id)).toEqual(["au"])
    expect(searchNotes([politePhrase], "polite way").notes.map((n) => n.id)).toEqual(["otsukare"])
    expect(searchNotes([politePhrase], "coworkers").notes.map((n) => n.id)).toEqual(["otsukare"])
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

  it("searches words and phrases independently per tab and ignores a lingering query when empty", () => {
    const sumimasen = word("sumimasen", "すみません", "すみません", "excuse me; sorry")
    const byTab = searchNotesByKind([sumimasen, late], "すみません")
    expect(byTab.word.match).toBe("exact")
    expect(byTab.phrase.match).toBe("weak")

    // A substring hit in phrases doesn't block typo fallback in words.
    const mention = phrase("umb-phrase", "傘をさす", null, "open an umbrela")
    const typoByTab = searchNotesByKind([umbrella, mention], "umbrela")
    expect(typoByTab.word.notes.map((n) => n.id)).toEqual(["kasa"])
    expect(typoByTab.word.match).toBe("weak")

    expect(searchNotesByKind([], "すみません")).toEqual({
      word: { match: "none", notes: [] },
      phrase: { match: "none", notes: [] }
    })
  })
})
