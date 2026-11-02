import { entries, EntryId, forms, glosses, senses } from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

// Dictionary data as stored, close to JMDict's own structure, which English entries share: an
// entry with its forms and senses, a sense with its glosses, in order. The importers build it,
// the backend reads it from the four tables, and the AI judges it. Every field comes from its
// column; the keys that tie a row to its parent and its position are the nesting itself.

/** `text` is a bytewise-collated custom column, which derives as unknown. */
const FormRow = createSelectSchema(forms, { text: Schema.String })

export const GlossRecord = Schema.Struct(Struct.pick(createSelectSchema(glosses).fields, ["text", "type"]))
export type GlossRecord = typeof GlossRecord.Type

export const FormRecord = Schema.Struct(
  Struct.pick(FormRow.fields, ["kind", "text", "common", "tags", "priorities", "restrictions", "noKanji"])
)
export type FormRecord = typeof FormRecord.Type

export const SenseRecord = Schema.Struct({
  glosses: Schema.Array(GlossRecord),
  ...Struct.pick(createSelectSchema(senses).fields, [
    "pos",
    "misc",
    "fields",
    "dialects",
    "info",
    "stagk",
    "stagr",
    "xrefs",
    "antonyms",
    "sources",
    "wasei"
  ])
})
export type SenseRecord = typeof SenseRecord.Type

export const EntryRecord = Schema.Struct({
  ...Struct.pick(createSelectSchema(entries, { id: EntryId }).fields, [
    "id",
    "language",
    "headword",
    "reading",
    "common",
    "priority"
  ]),
  forms: Schema.Array(FormRecord),
  senses: Schema.Array(SenseRecord)
})
export type EntryRecord = typeof EntryRecord.Type
