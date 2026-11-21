import { EntryId, type EntryRecord, UserId } from "@kotori/contracts"
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
  origins: [],
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
    id: EntryId.make("jmdict:1358280"),
    language: "ja",
    source: "jmdict",
    headword: "食べる",
    reading: "たべる",
    common: true,
    priority: 120,
    forms: [kanji("食べる"), kana("たべる")],
    senses: [sense(["to eat"]), sense(["to live on (e.g. a salary)", "to subsist on"])]
  },
  {
    id: EntryId.make("jmdict:1269130"),
    language: "ja",
    source: "jmdict",
    headword: "食う",
    reading: "くう",
    common: true,
    priority: 80,
    forms: [kanji("食う"), kana("くう")],
    senses: [sense(["to eat"], { misc: ["male"] }), sense(["to bite"])]
  },
  {
    id: EntryId.make("jmdict:1594790"),
    language: "ja",
    source: "jmdict",
    headword: "召し上がる",
    reading: "めしあがる",
    common: true,
    priority: 60,
    forms: [kanji("召し上がる"), kana("めしあがる")],
    senses: [sense(["to eat", "to drink"], { misc: ["hon"] })]
  },
  {
    id: EntryId.make("jmdict:1000000"),
    language: "ja",
    source: "jmdict",
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
    id: EntryId.make("en:eat"),
    language: "en",
    source: "enwiktionary",
    headword: "eat",
    reading: "/iːt/",
    common: true,
    priority: 90,
    forms: [spelling("eat", true), inflection("ate", ["past"]), inflection("eaten", ["past-participle"])],
    senses: [sense(["～を食べる。"], { pos: ["v", "vt"] }), sense(["食事をする"], { pos: ["v", "vi"] })]
  },
  {
    id: EntryId.make("en:Polish"),
    language: "en",
    source: "enwiktionary",
    headword: "Polish",
    reading: "",
    common: false,
    priority: 30,
    forms: [spelling("Polish")],
    senses: [sense(["ポーランドの"], { pos: ["adj"] })]
  },
  {
    id: EntryId.make("en:polish"),
    language: "en",
    source: "enwiktionary",
    headword: "polish",
    reading: "",
    common: true,
    priority: 40,
    forms: [spelling("polish", true), inflection("polished", ["past", "past-participle"])],
    senses: [sense(["磨く"], { pos: ["v"] })]
  },
  {
    id: EntryId.make("en:dine"),
    language: "en",
    source: "enwiktionary",
    headword: "dine",
    reading: "",
    common: false,
    priority: 20,
    forms: [spelling("dine")],
    senses: [sense(["食事をする", "正餐を取る"], { pos: ["v"] })]
  }
]

// Learner ids are uuids, as Better Auth's user ids are.
export const U1 = UserId.make("00000000-0000-4000-8000-000000000001")

/** A learner profile to hang learner data on; the database's defaults fill in the rest. */
export const learner = {
  id: U1,
  status: "approved",
  role: "user",
  nativeLanguage: "en",
  targetLanguage: "ja",
  onboardedAt: null,
  displayName: null,
  createdAt: new Date(0)
} satisfies typeof users.$inferInsert
