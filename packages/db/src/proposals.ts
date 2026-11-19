import { boolean, index, integer, jsonb, pgEnum, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, language, table, timestamptz } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { CautionKind } from "./cautions.ts"
import { type UserId, users } from "./users.ts"

export const proposalStatus = pgEnum("proposal_status", ["drafted", "linked", "rejected"])

export const proposalRoute = pgEnum("proposal_route", ["lookup", "sentence", "name", "other_language", "garbage"])

export const DraftSense = Schema.Struct({
  glosses: Schema.Array(Schema.String),
  pos: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.String),
  usagePatterns: Schema.Array(Schema.String)
})
export type DraftSense = typeof DraftSense.Type

export const DraftCaution = Schema.Struct({
  kind: CautionKind,
  text: Schema.String,
  sense: Schema.NullOr(Schema.Int),
  about: Schema.NullOr(Schema.String)
})
export type DraftCaution = typeof DraftCaution.Type

export const AskTriage = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Unknown),
  model: Schema.String,
  version: Schema.Int
})
export type AskTriage = typeof AskTriage.Type

export const DraftEntry = Schema.Struct({
  headword: Schema.String,
  reading: Schema.String,
  spellings: Schema.Array(Schema.String),
  frequency: Schema.Int,
  senses: Schema.Array(DraftSense),
  cautions: Schema.Array(DraftCaution)
})
export type DraftEntry = typeof DraftEntry.Type

export const proposals = table(
  "proposals",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    language: language().notNull(),
    query: text().notNull(),
    status: proposalStatus().notNull(),
    entryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    reason: text(),
    model: text().notNull(),
    route: proposalRoute(),
    triage: jsonb().$type<AskTriage>(),
    contested: boolean().notNull().default(false),
    requestedBy: uuid()
      .$type<UserId>()
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    reviewedAt: timestamptz()
  },
  (t) => [
    unique("proposals_query").on(t.language, t.query),
    index("proposals_status").on(t.status, t.createdAt),
    index("proposals_entry").on(t.entryId)
  ]
)

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
