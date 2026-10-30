import { Schema } from "effect"

/** Dictionary data as stored, close to JMDict's own structure. */
export const GlossRecord = Schema.Struct({
  text: Schema.String,
  type: Schema.NullOr(Schema.String)
})
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = Schema.Struct({
  kind: Schema.Literals(["kanji", "kana"]),
  text: Schema.String,
  common: Schema.Boolean,
  /** ke_inf / re_inf tag codes (e.g. "rK" rarely-used kanji, "sk" search-only). */
  tags: Schema.Array(Schema.String),
  /** JMDict priority markers: news1, ichi1, spec1, gai1, nf01… */
  priorities: Schema.Array(Schema.String),
  /** For kana forms: the kanji forms this reading belongs to (empty = all). */
  restrictions: Schema.Array(Schema.String),
  noKanji: Schema.Boolean
})
export type FormRecord = typeof FormRecord.Type

export const SenseRecord = Schema.Struct({
  glosses: Schema.Array(GlossRecord),
  pos: Schema.Array(Schema.String),
  misc: Schema.Array(Schema.String),
  fields: Schema.Array(Schema.String),
  dialects: Schema.Array(Schema.String),
  info: Schema.Array(Schema.String),
  stagk: Schema.Array(Schema.String),
  stagr: Schema.Array(Schema.String),
  xrefs: Schema.Array(Schema.String),
  antonyms: Schema.Array(Schema.String),
  /** The English words a loanword sense comes from, where JMDict names them (`lsource`): マンション ← mansion. */
  sources: Schema.Array(Schema.String),
  /** Whether JMDict marks the sense as wasei-eigo (和製英語), English-looking but coined in Japan. */
  wasei: Schema.Boolean
})
export type SenseRecord = typeof SenseRecord.Type

export const EntryRecord = Schema.Struct({
  id: Schema.Int,
  headword: Schema.String,
  reading: Schema.String,
  common: Schema.Boolean,
  priority: Schema.Int,
  forms: Schema.Array(FormRecord),
  senses: Schema.Array(SenseRecord)
})
export type EntryRecord = typeof EntryRecord.Type

/**
 * Normalises an English gloss or query for exact matching:
 * "to eat (a meal)" -> "eat", "The Sun" -> "sun".
 */
export const normalizeGloss = (text: string) =>
  text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the) /, "")

/** A word written in katakana alone, as loanwords are (スタイル, コーヒー); valid in JavaScript and Postgres. */
export const KATAKANA_WORD = "^[゠-ヿ]+$"

/** A katakana word that may be the loanword of an English word, and how the dictionary ties them. */
export interface LoanCandidate {
  /** The English word, normalised (`normalizeGloss`). */
  readonly word: string
  readonly entryId: number
  /** `gloss`: the entry has the word as a gloss; `source`: JMDict names it as the loan's source. */
  readonly by: "gloss" | "source"
}

/**
 * The loan candidates of English words among `entries`: common katakana words with the word as
 * a gloss or as their JMDict source, most frequent first, at most `limit` per word.
 * `DictionaryRepo.loanCandidates` is the same search in SQL; the golden fixture is cut with this.
 */
export const loanCandidatesIn = (
  entries: Iterable<EntryRecord>,
  words: ReadonlyArray<string>,
  limit: number
): Array<LoanCandidate> => {
  const wanted = new Set(words.map(normalizeGloss).filter((word) => word.length > 1))
  const katakana = new RegExp(KATAKANA_WORD, "u")
  const found = new Map<string, Array<LoanCandidate & { readonly priority: number }>>()
  for (const entry of entries) {
    if (!entry.common || !katakana.test(entry.headword)) continue
    const by = new Map<string, LoanCandidate["by"]>()
    for (const sense of entry.senses) {
      for (const gloss of sense.glosses) {
        const word = normalizeGloss(gloss.text)
        if (wanted.has(word) && !by.has(word)) by.set(word, "gloss")
      }
      for (const source of sense.sources) {
        const word = normalizeGloss(source)
        if (wanted.has(word)) by.set(word, "source")
      }
    }
    for (const [word, how] of by) {
      found.set(word, [...(found.get(word) ?? []), { word, entryId: entry.id, by: how, priority: entry.priority }])
    }
  }
  return [...found.values()].flatMap((candidates) =>
    candidates
      .sort((a, b) => b.priority - a.priority || a.entryId - b.entryId)
      .slice(0, limit)
      .map(({ word, entryId, by }) => ({ word, entryId, by }))
  )
}
