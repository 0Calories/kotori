import { boolean, index, integer, jsonb, pgEnum, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, language, table, timestamptz } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { PitfallKind } from "./pitfalls.ts"
import { type UserId, users } from "./users.ts"

/**
 * Where an Ask Kotori request stands: `pending` drafts await the admin (`kotori proposals`),
 * `linked` ones named an entry the dictionary already had, `rejected` ones Claude judged not to
 * be a real expression, and the admin turns pending into `approved` (a real entry) or `discarded`.
 */
export const proposalStatus = pgEnum("proposal_status", ["pending", "linked", "rejected", "approved", "discarded"])

/**
 * What kind of input Jev judged the query to be before Claude was asked: a lookup (the only
 * route that reaches Claude), a sentence for the Coach, a name, the wrong language, or mash.
 * Null when Jev wasn't configured, so the query went straight to Claude.
 */
export const proposalRoute = pgEnum("proposal_route", ["lookup", "sentence", "name", "other_language", "garbage"])

/**
 * A drafted sense, in the dictionary's own model: what the import reads from a sense, so an
 * approved draft becomes an entry with nothing translated. Everything in it is Kotori's.
 */
export const DraftSense = Schema.Struct({
  /** What it means, in the asker's native language. */
  glosses: Schema.Array(Schema.String),
  /** Part-of-speech codes from the dictionary's tags (`n`, `v`, `exp`…); empty when unclear. */
  pos: Schema.Array(Schema.String),
  /** Usage label codes from the label vocabulary (`col`, `sl`, `dated`…); others are not labels. */
  labels: Schema.Array(Schema.String),
  /** How natives use it, in the asker's native language: the sense's patterns. */
  patterns: Schema.Array(Schema.String)
})
export type DraftSense = typeof DraftSense.Type

/** A drafted pitfall: what would surprise a learner, scoped to a sense (by index) or the word. */
export const DraftPitfall = Schema.Struct({
  kind: PitfallKind,
  /** In the asker's native language; names a sense by its gloss, never its number. */
  text: Schema.String,
  sense: Schema.NullOr(Schema.Int),
  /** The word to compare with, as written; linked to its entry where exactly one matches. */
  about: Schema.NullOr(Schema.String)
})
export type DraftPitfall = typeof DraftPitfall.Type

/**
 * Jev's routing of an ask as it answered, kept so the thresholds can be re-derived offline: its
 * raw answers (the route Choice in both option orders), its model, and the question's version.
 */
export const AskTriage = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Unknown),
  model: Schema.String,
  version: Schema.Int
})
export type AskTriage = typeof AskTriage.Type

/**
 * A dictionary entry as Claude drafts it for a query the dictionary couldn't answer, in the
 * dictionary's own model (senses with labels and patterns, pitfalls), so approval copies it into
 * the dictionary unchanged. Drafts stored before this shape were migrated into it.
 */
export const DraftEntry = Schema.Struct({
  headword: Schema.String,
  /** IPA for an English word; kana for a Japanese one. Empty when unsure. */
  reading: Schema.String,
  /** Other ways it is written, searched like the headword. */
  spellings: Schema.Array(Schema.String),
  /** How familiar it is to natives today, 1–5, on the English dictionary's familiarity scale. */
  familiarity: Schema.Int,
  senses: Schema.Array(DraftSense),
  /** At most three. */
  pitfalls: Schema.Array(DraftPitfall)
})
export type DraftEntry = typeof DraftEntry.Type

/**
 * Dictionary entries Claude drafted on request ("Ask Kotori"), one per normalized query and
 * language. Never served as real entries: a draft is shown, marked unverified, only to learners
 * who asked for it, until the admin approves or discards it. Discarded and rejected rows stay as
 * a negative cache, so a query Claude or the admin turned down isn't paid for again.
 */
export const proposals = table(
  "proposals",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** The language of the word asked about: the asker's target language. */
    language: language().notNull(),
    /** The query, normalized (NFKC, trimmed, lowercased for English), the cache key. */
    query: text().notNull(),
    status: proposalStatus().notNull(),
    /** What Claude drafted; null when it linked or rejected instead. */
    draft: jsonb().$type<DraftEntry>(),
    /** The existing entry the query names, for `linked` and alias-approved proposals. */
    linkedEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    /** Why it was rejected (in the asker's native language) or discarded (the admin's words). */
    reason: text(),
    /** The model that answered. */
    model: text().notNull(),
    route: proposalRoute(),
    /** Jev's routing, as it answered; null when Jev wasn't asked. */
    triage: jsonb().$type<AskTriage>(),
    /** Claude rejected a query Jev was sure was a lookup: worth the admin's eye (`kotori proposals list`). */
    contested: boolean().notNull().default(false),
    /** Who asked first; their account going away doesn't take the answer with it. */
    requestedBy: uuid()
      .$type<UserId>()
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** When the admin acted on it. */
    reviewedAt: timestamptz()
  },
  (t) => [unique("proposals_query").on(t.language, t.query), index("proposals_status").on(t.status, t.createdAt)]
)

/** Who asked for which proposal, so each learner can revisit their own asks; its size is the ask count. */
export const proposalAsks = table(
  "proposal_asks",
  {
    proposalId: integer()
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.userId] }), index("proposal_asks_user").on(t.userId, t.createdAt)]
)
