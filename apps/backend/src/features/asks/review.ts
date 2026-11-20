import { Claude, interpretTriage } from "@kotori/ai"
import { AiUnavailable } from "@kotori/contracts"
import { entries, EntryId, proposals, ReviewState } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Effect, Match, Schema } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { getEntries } from "../dictionary/queries.ts"
import { syncEntrySearch } from "../dictionary/searchProjection.ts"
import { judge } from "./judge.ts"
import { updateVerdict } from "./queries.ts"

/**
 * Review lifecycle for Kotori-drafted entries (`entries.review_state`).
 * Every move, the states it is made from, and the state it leads to live in `REVIEW_MOVES`.
 */
export type EntryReviewState = (typeof entries.$inferSelect)["reviewState"]

export const REVIEW_MOVES = {
  approve: { from: ["unreviewed"] as const, to: "approved" as const },
  discard: { from: ["unreviewed"] as const, to: "discarded" as const },
  merge: { from: ["unreviewed"] as const, to: "discarded" as const }
} satisfies Record<string, { readonly from: ReadonlyArray<EntryReviewState>; readonly to: EntryReviewState }>

export type ReviewMove = keyof typeof REVIEW_MOVES

const canTransition = (state: EntryReviewState, move: ReviewMove): boolean => {
  const allowed: ReadonlyArray<EntryReviewState> = REVIEW_MOVES[move].from
  return Match.value(state).pipe(
    Match.when("unreviewed", () => allowed.includes("unreviewed")),
    Match.when("approved", () => allowed.includes("approved")),
    Match.when("discarded", () => allowed.includes("discarded")),
    Match.exhaustive
  )
}

export class NoSuchProposal extends Schema.TaggedError<NoSuchProposal>()("NoSuchProposal", {
  id: Schema.Int
}) {}

export class NoSuchEntry extends Schema.TaggedError<NoSuchEntry>()("NoSuchEntry", {
  entryId: EntryId
}) {}

export class InvalidReviewTransition extends Schema.TaggedError<InvalidReviewTransition>()("InvalidReviewTransition", {
  entryId: EntryId,
  from: ReviewState,
  move: Schema.Literals(["approve", "discard", "merge"])
}) {}

export class InvalidMergeTarget extends Schema.TaggedError<InvalidMergeTarget>()("InvalidMergeTarget", {
  entryId: EntryId,
  targetEntryId: EntryId,
  reason: Schema.String
}) {}

export class NotPending extends Schema.TaggedError<NotPending>()("NotPending", {
  id: Schema.Int,
  status: Schema.String
}) {}

export class NotRejected extends Schema.TaggedError<NotRejected>()("NotRejected", {
  id: Schema.Int,
  status: Schema.String
}) {}

const proposalById = Effect.fn("review.proposalById")(function* (db: DatabaseShape, id: number) {
  const rows = yield* db.select().from(proposals).where(eq(proposals.id, id)).pipe(Effect.orDie)
  if (rows[0] === undefined) return yield* new NoSuchProposal({ id })
  return rows[0]
})

export interface Approval {
  /** Override the drafted entry's headword when promoting it in place. */
  readonly headword?: string | undefined
}

/**
 * Promotes an `unreviewed` `kotori:` Drafted entry to `approved` in place without changing its
 * `kotori:` EntryId, updates `entry_search`, and marks linked proposals `approved`.
 */
export const approveEntry = Effect.fn("review.approveEntry")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  approval: Approval = {}
) {
  const now = new Date()
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [doc] = yield* tx.select().from(entries).where(eq(entries.id, entryId))
      if (doc === undefined) return yield* new NoSuchEntry({ entryId })
      if (doc.redirectTo !== null || !canTransition(doc.reviewState, "approve")) {
        return yield* new InvalidReviewTransition({ entryId, from: doc.reviewState, move: "approve" })
      }
      const nextBase =
        approval.headword === undefined || approval.headword === doc.base.headword
          ? doc.base
          : {
              ...doc.base,
              headword: approval.headword,
              forms: doc.base.forms.map((form, index) => (index === 0 ? { ...form, text: approval.headword! } : form))
            }
      const nextState = REVIEW_MOVES.approve.to
      const [updated] = yield* tx
        .update(entries)
        .set({ reviewState: nextState, base: nextBase, updatedAt: now })
        .where(eq(entries.id, entryId))
        .returning()
      yield* syncEntrySearch(tx, [updated!])
      yield* tx
        .update(proposals)
        .set({ status: "approved", reviewedAt: now })
        .where(eq(proposals.linkedEntryId, entryId))
      return { entryId, headword: updated!.base.headword }
    })
  )
})

/**
 * Discards an `unreviewed` `kotori:` Drafted entry: sets `review_state = 'discarded'`, removes it
 * from `entry_search`, retains the row as a negative-cache tombstone in `entries`, and marks linked
 * proposals `discarded`.
 */
export const discardEntry = Effect.fn("review.discardEntry")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  reason: string | null
) {
  const now = new Date()
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [doc] = yield* tx.select().from(entries).where(eq(entries.id, entryId))
      if (doc === undefined) return yield* new NoSuchEntry({ entryId })
      if (doc.redirectTo !== null || !canTransition(doc.reviewState, "discard")) {
        return yield* new InvalidReviewTransition({ entryId, from: doc.reviewState, move: "discard" })
      }
      const nextState = REVIEW_MOVES.discard.to
      const [updated] = yield* tx
        .update(entries)
        .set({ reviewState: nextState, updatedAt: now })
        .where(eq(entries.id, entryId))
        .returning()
      yield* syncEntrySearch(tx, [updated!])
      yield* tx
        .update(proposals)
        .set({ status: "discarded", reason, reviewedAt: now })
        .where(eq(proposals.linkedEntryId, entryId))
      return { entryId, headword: updated!.base.headword }
    })
  )
})

/**
 * Merges a duplicate `unreviewed` `kotori:` Drafted entry into an existing canonical Entry:
 * sets `redirect_to` to the canonical `EntryId`, hides the duplicate from `entry_search`, and
 * repoints linked proposals to the canonical Entry. Direct lookups of the merged `kotori:` ID
 * transparently resolve to the canonical Entry.
 */
export const mergeEntry = Effect.fn("review.mergeEntry")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  targetEntryId: EntryId
) {
  if (entryId === targetEntryId) {
    return yield* new InvalidMergeTarget({ entryId, targetEntryId, reason: "cannot merge an entry into itself" })
  }
  const now = new Date()
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [doc] = yield* tx.select().from(entries).where(eq(entries.id, entryId))
      if (doc === undefined) return yield* new NoSuchEntry({ entryId })
      if (doc.redirectTo !== null || !canTransition(doc.reviewState, "merge")) {
        return yield* new InvalidReviewTransition({ entryId, from: doc.reviewState, move: "merge" })
      }
      const [target] = yield* tx.select().from(entries).where(eq(entries.id, targetEntryId))
      if (target === undefined) return yield* new NoSuchEntry({ entryId: targetEntryId })
      if (target.reviewState === "discarded" && target.redirectTo === null) {
        return yield* new InvalidMergeTarget({
          entryId,
          targetEntryId,
          reason: "cannot merge into a discarded entry"
        })
      }
      const canonicalId = target.redirectTo ?? target.id
      if (canonicalId === entryId) {
        return yield* new InvalidMergeTarget({
          entryId,
          targetEntryId,
          reason: "merge target redirects back to this entry"
        })
      }
      const [canonical] =
        canonicalId === target.id ? [target] : yield* tx.select().from(entries).where(eq(entries.id, canonicalId))
      if (canonical === undefined) return yield* new NoSuchEntry({ entryId: canonicalId })

      const [updated] = yield* tx
        .update(entries)
        .set({ redirectTo: canonical.id, reviewState: REVIEW_MOVES.merge.to, updatedAt: now })
        .where(eq(entries.id, entryId))
        .returning()
      yield* syncEntrySearch(tx, [updated!])
      yield* tx
        .update(proposals)
        .set({ status: "approved", linkedEntryId: canonical.id, reviewedAt: now })
        .where(eq(proposals.linkedEntryId, entryId))
      return { entryId, targetEntryId: canonical.id, headword: canonical.base.headword }
    })
  )
})

/** Approves a pending proposal's `kotori:` Drafted entry in place without changing its ID. */
export const approveProposal = Effect.fn("review.approveProposal")(function* (
  db: DatabaseShape,
  id: number,
  approval: Approval = {}
) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "pending" || proposal.linkedEntryId === null) {
    return yield* new NotPending({ id, status: proposal.status })
  }
  return yield* approveEntry(db, proposal.linkedEntryId, approval)
})

/** Discards a pending proposal's `kotori:` Drafted entry, keeping it as a negative cache. */
export const discardProposal = Effect.fn("review.discardProposal")(function* (
  db: DatabaseShape,
  id: number,
  reason: string | null
) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "pending" || proposal.linkedEntryId === null) {
    return yield* new NotPending({ id, status: proposal.status })
  }
  const result = yield* discardEntry(db, proposal.linkedEntryId, reason)
  return { ...result, query: proposal.query }
})

/** Merges a pending proposal's duplicate `kotori:` Drafted entry into an existing canonical Entry. */
export const mergeProposal = Effect.fn("review.mergeProposal")(function* (
  db: DatabaseShape,
  id: number,
  targetEntryId: EntryId
) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "pending" || proposal.linkedEntryId === null) {
    return yield* new NotPending({ id, status: proposal.status })
  }
  return yield* mergeEntry(db, proposal.linkedEntryId, targetEntryId)
})

/**
 * Asks Claude again about a rejected query, replacing the answer: the admin's remedy for a wrong
 * rejection, Claude's or Jev's. Claude's answer stands whatever Jev routed, so the route becomes
 * a lookup, and the app shows Claude's verdict rather than Jev's pointer.
 */
export const redoProposal = Effect.fn("review.redoProposal")(function* (db: DatabaseShape, id: number) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "rejected") return yield* new NotRejected({ id, status: proposal.status })
  const claude = yield* Claude
  if (!(yield* claude.available)) return yield* new AiUnavailable({ message: "Claude isn't available right now." })
  const triaged =
    proposal.triage === null ? null : { record: proposal.triage, reading: interpretTriage(proposal.triage.answers) }
  const updated = yield* updateVerdict(db, id, yield* judge(db, proposal.query, proposal.language, triaged))
  const [linked] = updated.linkedEntryId === null ? [] : yield* getEntries(db, [updated.linkedEntryId])
  return { proposal: updated, linked: linked?.headword ?? null }
})
