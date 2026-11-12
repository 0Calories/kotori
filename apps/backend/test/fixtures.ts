import { EntryId, type EntryRecord, NoteId, UserId } from "@kotori/contracts"
import type { users } from "@kotori/db"

// Dictionary entries and learner ids shared by the PGlite query suites.

export const sense = (glosses: Array<string>, extra: Partial<EntryRecord["senses"][number]> = {}) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1", "vt"],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  sources: [],
  wasei: false,
  ...extra
})

export const kanji = (text: string, common = true) => ({
  kind: "kanji" as const,
  text,
  common,
  tags: [],
  priorities: common ? ["ichi1"] : [],
  restrictions: [],
  noKanji: false
})
export const kana = (text: string, common = true) => ({ ...kanji(text, common), kind: "kana" as const })

/** Japanese words, from JMDict. */
export const entries: Array<EntryRecord> = [
  {
    id: EntryId.make(1358280),
    language: "ja",
    headword: "食べる",
    reading: "たべる",
    common: true,
    priority: 120,
    forms: [kanji("食べる"), kana("たべる")],
    senses: [sense(["to eat"]), sense(["to live on (e.g. a salary)", "to subsist on"])]
  },
  {
    id: EntryId.make(1269130),
    language: "ja",
    headword: "食う",
    reading: "くう",
    common: true,
    priority: 80,
    forms: [kanji("食う"), kana("くう")],
    senses: [sense(["to eat"], { misc: ["male"] }), sense(["to bite"])]
  },
  {
    id: EntryId.make(1594790),
    language: "ja",
    headword: "召し上がる",
    reading: "めしあがる",
    common: true,
    priority: 60,
    forms: [kanji("召し上がる"), kana("めしあがる")],
    senses: [sense(["to eat", "to drink"], { misc: ["hon"] })]
  },
  {
    id: EntryId.make(1000000),
    language: "ja",
    headword: "鯛焼き",
    reading: "たいやき",
    common: false,
    priority: 0,
    forms: [kanji("鯛焼き", false), kana("たいやき", false)],
    senses: [sense(["taiyaki", "fish-shaped pancake filled with bean jam"], { pos: ["n"] })]
  }
]

export const spelling = (text: string, common = false) => ({
  ...kanji(text, common),
  kind: "spelling" as const,
  priorities: []
})
const inflection = (text: string, tags: Array<string>) => ({
  ...spelling(text),
  kind: "inflection" as const,
  tags
})

/** English words, with Japanese glosses. */
export const english: Array<EntryRecord> = [
  {
    id: EntryId.make(100000001),
    language: "en",
    headword: "eat",
    reading: "/iːt/",
    common: true,
    priority: 90,
    forms: [spelling("eat", true), inflection("ate", ["past"]), inflection("eaten", ["past-participle"])],
    senses: [sense(["～を食べる。"], { pos: ["v", "vt"] }), sense(["食事をする"], { pos: ["v", "vi"] })]
  },
  {
    id: EntryId.make(100000002),
    language: "en",
    headword: "Polish",
    reading: "",
    common: false,
    priority: 30,
    forms: [spelling("Polish")],
    senses: [sense(["ポーランドの"], { pos: ["adj"] })]
  },
  {
    id: EntryId.make(100000003),
    language: "en",
    headword: "polish",
    reading: "",
    common: true,
    priority: 40,
    forms: [spelling("polish", true), inflection("polished", ["past", "past-participle"])],
    senses: [sense(["磨く"], { pos: ["v"] })]
  },
  {
    id: EntryId.make(100000004),
    language: "en",
    headword: "dine",
    reading: "",
    common: false,
    priority: 20,
    forms: [spelling("dine")],
    senses: [sense(["食事をする", "正餐を取る"], { pos: ["v"] })]
  }
]

// Study ids are uuids, as Better Auth's user ids and the API's note ids are.
export const U1 = UserId.make("00000000-0000-4000-8000-000000000001")
export const N1 = NoteId.make("00000000-0000-4000-8000-00000000000a")
export const N2 = NoteId.make("00000000-0000-4000-8000-00000000000b")
export const N3 = NoteId.make("00000000-0000-4000-8000-00000000000c")

/** A learner profile to hang study data on; the database's defaults fill in the rest. */
export const learner = {
  id: U1,
  status: "approved",
  role: "user",
  nativeLanguage: "en",
  targetLanguage: "ja",
  onboardedAt: null,
  displayName: null,
  timezone: "Asia/Tokyo",
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  createdAt: new Date(0)
} satisfies typeof users.$inferInsert
