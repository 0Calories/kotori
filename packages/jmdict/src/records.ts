import { Schema } from "effect"

/**
 * A JMDict entry as the parser produces it, close to JMDict's own structure. The
 * dictionary stores entries in this shape and reads them back in it.
 */
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
  antonyms: Schema.Array(Schema.String)
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
