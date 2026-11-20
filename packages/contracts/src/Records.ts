import {
  BaseForm,
  BaseGloss,
  BaseSense,
  Casting,
  entries,
  EntryId,
  SenseOrigin,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { Casting, SenseOrigin, SentenceMedium, SentenceTone, SpeakerAge, SpeakerGender }

// Dictionary data as stored in `entries.base`: an entry with its forms and senses, a sense with
// its glosses, in order. The importers build it, the backend reads it from `entries.base`, and
// the AI judges it.

export const GlossRecord = BaseGloss
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = BaseForm
export type FormRecord = typeof FormRecord.Type

export const SenseRecord = Schema.Struct(
  Struct.pick(BaseSense.fields, [
    "glosses",
    "pos",
    "misc",
    "fields",
    "dialects",
    "info",
    "stagk",
    "stagr",
    "xrefs",
    "antonyms",
    "origins",
    "wasei"
  ])
)
export type SenseRecord = typeof SenseRecord.Type

export const EntryRecord = Schema.Struct({
  ...Struct.pick(createSelectSchema(entries, { id: EntryId }).fields, [
    "id",
    "language",
    "source",
    "common",
    "priority"
  ]),
  headword: Schema.String,
  reading: Schema.String,
  forms: Schema.Array(FormRecord),
  senses: Schema.Array(SenseRecord)
})
export type EntryRecord = typeof EntryRecord.Type
