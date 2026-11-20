import { DRAFT_STANDING, type ProposalStatus } from "@kotori/contracts"
import {
  type AskTriage,
  type DraftEntry,
  entries,
  type EntryId,
  type EntryReview,
  entryReview,
  type Language,
  notes,
  proposalAsks,
  proposals,
  type UserId
} from "@kotori/db"
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm"
import { Effect, Match, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

export type ProposalRow = typeof proposals.$inferSelect

export interface Verdict {
  readonly status: ProposalRow["status"]
  readonly draft: DraftEntry | null
  readonly entryId: EntryId | null
  readonly reason: string | null
  readonly model: string
  readonly route: ProposalRow["route"]
  readonly triage: AskTriage | null
  readonly contested: boolean
}

export type SettledVerdict = Omit<Verdict, "draft">

export interface NewProposal extends SettledVerdict {
  readonly language: Language
  readonly query: string
  readonly requestedBy: UserId
  readonly now: Date
}

export type DraftedEntryState = EntryReview | "gone"

export const standing = (status: ProposalRow["status"], entry: DraftedEntryState): ProposalStatus => {
  switch (status) {
    case "linked":
      return "linked"
    case "rejected":
      return "rejected"
    case "drafted":
      return DRAFT_STANDING[entry]
  }
}

const DRAFTED_ENTRY_STATES: ReadonlyArray<DraftedEntryState> = [...entryReview.enumValues, "gone"]

export const standingIs = (shown: ProposalStatus): SQL | undefined =>
  Match.value(shown).pipe(
    Match.when("linked", () => eq(proposals.status, "linked")),
    Match.when("rejected", () => eq(proposals.status, "rejected")),
    Match.orElse((drafted) =>
      and(
        eq(proposals.status, "drafted"),
        or(
          ...DRAFTED_ENTRY_STATES.filter((entry) => DRAFT_STANDING[entry] === drafted).map((entry) =>
            entry === "gone" ? isNull(entries.id) : eq(entries.review, entry)
          )
        )
      )
    )
  )

export const updateVerdict = (db: DatabaseShape, id: number, verdict: SettledVerdict) =>
  db
    .update(proposals)
    .set({ ...verdict, reviewedAt: null })
    .where(eq(proposals.id, id))
    .returning()
    .pipe(
      Effect.map((rows) => rows[0]!),
      Effect.orDie
    )

export const findProposal = (db: DatabaseShape, language: Language, query: string) =>
  db
    .select()
    .from(proposals)
    .where(and(eq(proposals.language, language), eq(proposals.query, query)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

export const insertProposal = Effect.fn("asks.insertProposal")(function* (db: DatabaseShape, proposal: NewProposal) {
  const inserted = yield* db
    .insert(proposals)
    .values({
      language: proposal.language,
      query: proposal.query,
      status: proposal.status,
      entryId: proposal.entryId,
      reason: proposal.reason,
      model: proposal.model,
      route: proposal.route,
      triage: proposal.triage,
      contested: proposal.contested,
      requestedBy: proposal.requestedBy,
      createdAt: proposal.now
    })
    .onConflictDoNothing({ target: [proposals.language, proposals.query] })
    .returning()
  if (inserted[0] !== undefined) return inserted[0]
  return Option.getOrThrow(yield* findProposal(db, proposal.language, proposal.query))
}, Effect.orDie)

export const recordAsk = (db: DatabaseShape, proposalId: number, userId: UserId, now: Date) =>
  db
    .insert(proposalAsks)
    .values({ proposalId, userId, createdAt: now })
    .onConflictDoNothing()
    .pipe(Effect.asVoid, Effect.orDie)

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

export const repointProposals = (db: DatabaseShape, from: EntryId, to: EntryId, now: Date) =>
  db
    .update(proposals)
    .set({ entryId: to, reviewedAt: now })
    .where(eq(proposals.entryId, from))
    .pipe(Effect.asVoid, Effect.orDie)

export const moveNotes = Effect.fn("asks.moveNotes")(function* (db: DatabaseShape, from: EntryId, to: EntryId) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const kept = tx.select({ userId: notes.userId }).from(notes).where(eq(notes.entryId, to))
      yield* tx.delete(notes).where(and(eq(notes.entryId, from), inArray(notes.userId, kept)))
      yield* tx.update(notes).set({ entryId: to }).where(eq(notes.entryId, from))
    })
  )
}, Effect.orDie)
