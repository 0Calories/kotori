import { Formality } from "@kotori/domain"
import { Schema } from "effect"

export const SituationDraft = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: Schema.String,
  aliases: Schema.Array(Schema.String),
  note: Schema.String,
  phrases: Schema.Array(Schema.Struct({
    ja: Schema.String,
    reading: Schema.String,
    en: Schema.String,
    formality: Formality
  })),
  words: Schema.Array(Schema.Struct({
    word: Schema.String,
    reading: Schema.String
  }))
})
export type SituationDraft = typeof SituationDraft.Type

export const GeneratedSituation = Schema.Struct({
  id: Schema.String,
  aliases: Schema.Array(Schema.String),
  note: Schema.String,
  phrases: SituationDraft.fields.phrases,
  words: SituationDraft.fields.words
})

export const GeneratedBatch = Schema.Struct({
  situations: Schema.Array(GeneratedSituation)
})
