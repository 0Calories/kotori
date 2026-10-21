import * as Schema from "effect/Schema"
import { EntryId, SearchResult } from "./Dictionary.ts"
import { Formality } from "./Nuance.ts"

export const SituationPhrase = Schema.Struct({
  ja: Schema.String,
  reading: Schema.String,
  en: Schema.String,
  formality: Formality
})
export type SituationPhrase = typeof SituationPhrase.Type

export const SituationEntry = Schema.Struct({
  id: EntryId,
  headword: Schema.String,
  reading: Schema.String,
  meanings: Schema.Array(Schema.String)
})
export type SituationEntry = typeof SituationEntry.Type

export const SituationHit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: Schema.String,
  note: Schema.String,
  score: Schema.Number,
  keywordRank: Schema.NullOr(Schema.Int),
  vectorRank: Schema.NullOr(Schema.Int),
  cosine: Schema.NullOr(Schema.Number),
  phrases: Schema.Array(SituationPhrase),
  entries: Schema.Array(SituationEntry)
})
export type SituationHit = typeof SituationHit.Type

/** Dictionary results plus situation matches. `fallback` means "How do I say" should run. */
export const SituationSearchResult = Schema.Struct({
  query: Schema.String,
  fallback: Schema.Boolean,
  threshold: Schema.Number,
  vector: Schema.Literals(["sqlite-vec", "blob"]),
  situations: Schema.Array(SituationHit),
  dictionary: SearchResult
})
export type SituationSearchResult = typeof SituationSearchResult.Type
