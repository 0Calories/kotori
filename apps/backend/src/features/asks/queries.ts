import { type DraftEntry, type EntryId, type Language, proposalAsks, proposals, type UserId } from "@kotori/db"
import { and, count, desc, eq, gte } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

export type ProposalRow = typeof proposals.$inferSelect

export interface NewProposal {
  readonly language: Language
  readonly query: string
  readonly status: ProposalRow["status"]
  readonly draft: DraftEntry | null
  readonly linkedEntryId: EntryId | null
  readonly reason: string | null
  readonly model: string
  readonly requestedBy: UserId
  readonly now: Date
}

/** The proposal for a normalized query, whoever asked first. */
export const findProposal = (db: DatabaseShape, language: Language, query: string) =>
  db
    .select()
    .from(proposals)
    .where(and(eq(proposals.language, language), eq(proposals.query, query)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

/**
 * Saves a new proposal. Two learners asking the same new query at once race on the unique
 * (language, query); the loser keeps the winner's row, so one question is one answer.
 */
export const insertProposal = Effect.fn("asks.insertProposal")(function* (db: DatabaseShape, proposal: NewProposal) {
  const inserted = yield* db
    .insert(proposals)
    .values({
      language: proposal.language,
      query: proposal.query,
      status: proposal.status,
      draft: proposal.draft,
      linkedEntryId: proposal.linkedEntryId,
      reason: proposal.reason,
      model: proposal.model,
      requestedBy: proposal.requestedBy,
      createdAt: proposal.now
    })
    .onConflictDoNothing({ target: [proposals.language, proposals.query] })
    .returning()
  if (inserted[0] !== undefined) return inserted[0]
  return Option.getOrThrow(yield* findProposal(db, proposal.language, proposal.query))
}, Effect.orDie)

/** Remembers that a learner asked, so `asksFor` can show them the answer again. Asking twice is one row. */
export const recordAsk = (db: DatabaseShape, proposalId: number, userId: UserId, now: Date) =>
  db
    .insert(proposalAsks)
    .values({ proposalId, userId, createdAt: now })
    .onConflictDoNothing()
    .pipe(Effect.asVoid, Effect.orDie)

/** The learner's own asks, newest first. */
export const asksFor = (db: DatabaseShape, userId: UserId) =>
  db
    .select({ proposal: proposals })
    .from(proposalAsks)
    .innerJoin(proposals, eq(proposals.id, proposalAsks.proposalId))
    .where(eq(proposalAsks.userId, userId))
    .orderBy(desc(proposalAsks.createdAt))
    .limit(100)
    .pipe(
      Effect.map((rows) => rows.map((row) => row.proposal)),
      Effect.orDie
    )

/** How many proposals Claude has answered since `since`: the global spend, cached asks aside. */
export const proposalsSince = (db: DatabaseShape, since: Date) =>
  db
    .select({ n: count() })
    .from(proposals)
    .where(gte(proposals.createdAt, since))
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )
