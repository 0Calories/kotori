import * as Schema from "effect/Schema"
import { Form } from "./Dictionary.ts"
import { Language } from "./Language.ts"

/** Dictionary data as stored, close to JMDict's own structure; English entries share it. */
export const GlossRecord = Schema.Struct({
  text: Schema.String,
  type: Schema.NullOr(Schema.String)
})
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = Schema.Struct({
  /** Japanese words are written in kanji and kana; English ones have spellings and inflections. */
  kind: Form.fields.kind,
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
  language: Language,
  headword: Schema.String,
  reading: Schema.String,
  common: Schema.Boolean,
  priority: Schema.Int,
  forms: Schema.Array(FormRecord),
  senses: Schema.Array(SenseRecord)
})
export type EntryRecord = typeof EntryRecord.Type
