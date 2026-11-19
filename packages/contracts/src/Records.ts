import {
  Casting,
  entries,
  EntryId,
  forms,
  glosses,
  SenseOrigin,
  senses,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { Casting, SenseOrigin, SentenceMedium, SentenceTone, SpeakerAge, SpeakerGender }

const List = Schema.Array(Schema.String)

// `text` is a bytewise-collated custom column, which `createSelectSchema` derives as `unknown`.
const FormRow = createSelectSchema(forms, { text: Schema.String, tags: List, priorities: List, restrictions: List })

const SenseRow = createSelectSchema(senses, {
  pos: List,
  misc: List,
  fields: List,
  dialects: List,
  info: List,
  stagk: List,
  stagr: List,
  xrefs: List,
  antonyms: List,
  origins: Schema.Array(SenseOrigin)
})

export const GlossRecord = Schema.Struct(Struct.pick(createSelectSchema(glosses).fields, ["text", "type"]))
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = Schema.Struct(
  Struct.pick(FormRow.fields, ["kind", "text", "common", "tags", "priorities", "restrictions", "noKanji"])
)
export type FormRecord = typeof FormRecord.Type

export const SenseRecord = Schema.Struct({
  glosses: Schema.Array(GlossRecord),
  ...Struct.pick(SenseRow.fields, [
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
})
export type SenseRecord = typeof SenseRecord.Type

export const EntryRecord = Schema.Struct({
  ...Struct.pick(createSelectSchema(entries, { id: EntryId }).fields, [
    "id",
    "language",
    "source",
    "headword",
    "reading",
    "common",
    "priority"
  ]),
  forms: Schema.Array(FormRecord),
  senses: Schema.Array(SenseRecord)
})
export type EntryRecord = typeof EntryRecord.Type
