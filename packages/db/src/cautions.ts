import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, pgEnum, smallint, text, unique } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const cautionKind = pgEnum("caution_kind", [
  "rude_upward",
  "keigo_direction",
  "set_phrase",
  "particle_pattern",
  "gendered_speech",
  "wasei_eigo",
  "textbook_english",
  "directness",
  "variety",
  "confusable",
  "collocation",
  "tone"
])

export const CautionKind = Schema.Literals(cautionKind.enumValues)
export type CautionKind = typeof CautionKind.Type

export const CAUTION_KINDS: Readonly<Record<"ja" | "en", ReadonlyArray<CautionKind>>> = {
  ja: [
    "rude_upward",
    "keigo_direction",
    "set_phrase",
    "particle_pattern",
    "gendered_speech",
    "confusable",
    "collocation",
    "tone"
  ],
  en: ["wasei_eigo", "textbook_english", "directness", "variety", "confusable", "collocation", "tone"]
}

export const MAX_CAUTIONS = 3

export const cautions = table(
  "cautions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    sense: integer(),
    rank: smallint().notNull(),
    kind: cautionKind().notNull(),
    text: text().notNull(),
    aboutEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    source: source().notNull()
  },
  (t) => [
    unique("cautions_rank").on(t.entryId, t.rank),
    check("cautions_rank_range", sql`${t.rank} BETWEEN 1 AND ${sql.raw(String(MAX_CAUTIONS))}`),
    // A word-level caution's null sense skips the composite foreign-key check (`MATCH SIMPLE`).
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("cautions_about")
      .on(t.aboutEntryId)
      .where(sql`${t.aboutEntryId} IS NOT NULL`)
  ]
)
