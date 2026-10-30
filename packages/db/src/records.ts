import { Schema } from "effect"
import { formKind, language } from "./schema/dictionary.ts"

/** Dictionary data as stored, close to JMDict's own structure; English entries share it. */
export const GlossRecord = Schema.Struct({
  text: Schema.String,
  type: Schema.NullOr(Schema.String)
})
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = Schema.Struct({
  /** Japanese words are written in kanji and kana; English ones have spellings and inflections. */
  kind: Schema.Literals(formKind.enumValues),
  text: Schema.String,
  common: Schema.Boolean,
  /** ke_inf / re_inf tag codes (e.g. "rK" rarely-used kanji, "sk" search-only); what an inflection is ("past"). */
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
  /** The headword's language, and so which language the glosses are in: the other one. */
  language: Schema.Literals(language.enumValues),
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

/** Bracketed asides in a gloss, innermost first: (…), 〈…〉, 《…》, 〔…〕 and […] after NFKC. */
const ASIDE = /\([^()]*\)|〈[^〈〉]*〉|《[^《》]*》|〔[^〔〕]*〕|\[[^[\]]*\]/g

/**
 * Normalises a Japanese gloss or query for exact matching, the way `normalizeGloss` does
 * English: "～を食べる。" -> "食べる", "（資源や金銭を）消費する" -> "消費する", "『走る』" -> "走る".
 */
export const normalizeJapaneseGloss = (text: string) => {
  let norm = text.normalize("NFKC")
  // Twice, for an aside inside an aside.
  norm = norm.replace(ASIDE, "").replace(ASIDE, "")
  return norm
    .replace(/[『』「」【】"]/g, "")
    .replace(/^\s*[~〜…・.]+\s*(?:を|に|が|と|で|の|へ|から|より)?/, "")
    .replace(/[\s。、.,!?！？・;；:：]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

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
    if (entry.language !== "ja" || !entry.common || !katakana.test(entry.headword)) continue
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

/** How much of one sense's glosses another must share to count as the same sense after an edit. */
const SAME_SENSE = 0.5

/**
 * Where each of an entry's stored senses went in a re-import: the position of the sense with the
 * same glosses, in the same order, or, failing that, of the one sharing the most of them (at
 * least half, by Jaccard), or null when nothing comes close. Enrichment is keyed by position, so
 * a re-import that reorders senses (the English dictionary ranks them at import) moves each
 * row with its sense rather than leaving it on whatever sense now sits there.
 */
export const matchSenses = (
  stored: ReadonlyArray<ReadonlyArray<string>>,
  incoming: ReadonlyArray<ReadonlyArray<string>>
): Array<number | null> => {
  const moves: Array<number | null> = stored.map(() => null)
  const taken = new Set<number>()
  const key = (glosses: ReadonlyArray<string>) => JSON.stringify(glosses)
  const free = new Map<string, Array<number>>()
  incoming.forEach((glosses, index) => free.set(key(glosses), [...(free.get(key(glosses)) ?? []), index]))
  stored.forEach((glosses, from) => {
    const to = free.get(key(glosses))?.shift()
    if (to === undefined) return
    moves[from] = to
    taken.add(to)
  })
  const pairs: Array<{ readonly from: number; readonly to: number; readonly overlap: number }> = []
  stored.forEach((glosses, from) => {
    if (moves[from] !== null) return
    const own = new Set(glosses)
    incoming.forEach((other, to) => {
      if (taken.has(to)) return
      const shared = other.filter((gloss) => own.has(gloss)).length
      const overlap = shared / new Set([...glosses, ...other]).size
      if (overlap >= SAME_SENSE) pairs.push({ from, to, overlap })
    })
  })
  for (const { from, to } of pairs.sort((a, b) => b.overlap - a.overlap || a.from - b.from || a.to - b.to)) {
    if (moves[from] !== null || taken.has(to)) continue
    moves[from] = to
    taken.add(to)
  }
  return moves
}
