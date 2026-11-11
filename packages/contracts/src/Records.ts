import {
  entries,
  EntryId,
  forms,
  glosses,
  SenseOrigin,
  senses,
  sentenceMedium,
  sentenceTone,
  speakerAge,
  speakerGender
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { SenseOrigin }

// Dictionary data as stored, close to JMDict's own structure, which English entries share: an
// entry with its forms and senses, a sense with its glosses, in order. The importers build it,
// the backend reads it from the four tables, and the AI judges it. Every field comes from its
// column; the keys that tie a row to its parent and its position are the nesting itself. Lists
// are arrays here, empty or not; the tables store an empty one as NULL (`textList`).

const List = Schema.Array(Schema.String)

/** `text` is a bytewise-collated custom column, which derives as unknown. */
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

// Internal example-sentence voice signals shared between `@kotori/db` and `@kotori/ai` (never on wire).

export const SpeakerGender = createSelectSchema(speakerGender)
export type SpeakerGender = typeof SpeakerGender.Type

export const SpeakerAge = createSelectSchema(speakerAge)
export type SpeakerAge = typeof SpeakerAge.Type

export const SentenceMedium = createSelectSchema(sentenceMedium)
export type SentenceMedium = typeof SentenceMedium.Type

export const SentenceTone = createSelectSchema(sentenceTone)
export type SentenceTone = typeof SentenceTone.Type
