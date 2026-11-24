import type { EntryId, Language, Note, NoteId } from "@kotori/contracts"
import { describe, expect, it } from "vitest"
import { searchNotes } from "../src/lib/noteSearch.ts"

const note = (
  id: string,
  headword: string,
  reading: string,
  glosses: ReadonlyArray<string>,
  language: Language = "ja"
): Note => ({
  id: id as NoteId,
  createdAt: new Date(0),
  entry: {
    id: `jmdict:${id}` as EntryId,
    language,
    source: language === "ja" ? "jmdict" : "enwiktionary",
    reviewState: "approved",
    headword,
    reading
  },
  senses: [{ glosses: [...glosses] }]
})

const taberu = note("taberu", "食べる", "たべる", ["to eat", "to live on (e.g. a salary)"])
const umbrella = note("kasa", "傘", "かさ", ["umbrella", "parasol"])
const neko = note("neko", "猫", "ねこ", ["cat"])
const coffee = note("koohii", "コーヒー", "コーヒー", ["coffee"])
const thinIce = note("usugori", "薄氷を踏む", "はくひょうをふむ", ["to skate on thin ice"])
const english = note("apple", "apple", "/ˈæp.əl/", ["りんご", "林檎"], "en")

const notes = [taberu, umbrella, neko, coffee, thinIce, english]
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

    const matsu = note("matsu", "待つ", "まつ", ["to wait"])
    const nakama = note("nakama", "仲間", "なかま", ["mate", "colleague"])
    const toru = note("toru", "取る", "とる", ["to take"])
    const take = note("take", "竹", "たけ", ["bamboo"])
    const taku = note("taku", "炊く", "たく", ["to cook rice"])
    expect(searchNotes([matsu, nakama], "mate").notes.map((n) => n.id)).toEqual(["nakama"])
    expect(searchNotes([taku, take, toru], "take").notes.map((n) => n.id)).toEqual(["toru", "take"])
  })

  it("finds words by their meaning, inflected or with a pronoun", () => {
    expect(ids("eat")[0]).toBe("taberu")
    expect(ids("eating")[0]).toBe("taberu")
    expect(ids("parasol")).toEqual(["kasa"])
  })

  it("ranks whole-word and placeholder matches in English forms above prefixes", () => {
    const walkAway = note("walk-away", "walk away", "", ["立ち去る"], "en")
    const neverWalk = note("never-walk", "never walk away", "", ["決して立ち去らない"], "en")
    const walkabout = note("walkabout", "walkabout", "/ˈwɔːk.ə.baʊt/", ["徒歩の旅"], "en")
    const tellSomeone = note("tell-sb", "tell someone", "", ["誰かに話す"], "en")

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

    const readPast = note("read", "read", "/rɛd/", ["読む"], "en")
    expect(searchNotes([readPast], "red").notes).toEqual([])
  })

  it("searches English meanings even when they quote Japanese", () => {
    const withParticle = note("au", "会う", "あう", ["to meet (e.g. 友達に)"], "ja")
    expect(searchNotes([withParticle], "meet").notes.map((n) => n.id)).toEqual(["au"])
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
