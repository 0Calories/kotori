import { Language } from "@kotori/domain"
import { Schema } from "effect"

/** Dictionary data as stored, close to JMDict's own structure; English entries share it. */
export const GlossRecord = Schema.Struct({
  text: Schema.String,
  type: Schema.NullOr(Schema.String)
})
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = Schema.Struct({
  /** Japanese words are written in kanji and kana; English ones have spellings and inflections. */
  kind: Schema.Literals(["kanji", "kana", "spelling", "inflection"]),
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
  antonyms: Schema.Array(Schema.String)
})
export type SenseRecord = typeof SenseRecord.Type

export const EntryRecord = Schema.Struct({
  id: Schema.Int,
  /** The headword's language, and so which language the glosses are in: the other one. */
  language: Language,
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
