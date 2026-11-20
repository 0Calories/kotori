import { entries, type EntryId, type EntryReview, type ReviewRule, reviewsWhere } from "@kotori/db"
import { and, inArray, notInArray } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

const MOVES = {
  approve: { from: ["unreviewed"], to: "approved" },
  discard: { from: ["unreviewed"], to: "discarded" }
} as const satisfies Record<string, { readonly from: ReadonlyArray<EntryReview>; readonly to: EntryReview }>

export type ReviewMove = keyof typeof MOVES

export const reviewEntries = Effect.fn("dictionary.reviewEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>,
  move: ReviewMove
) {
  if (ids.length === 0) return []
  const moved = yield* db
    .update(entries)
    .set({ review: MOVES[move].to })
    .where(and(inArray(entries.id, [...ids]), inArray(entries.review, [...MOVES[move].from])))
    .returning({ id: entries.id })
  return moved.map((row) => row.id)
}, Effect.orDie)

export const reviewedAs = (rule: ReviewRule) => inArray(entries.review, reviewsWhere(rule))

export type EntryScope = Extract<ReviewRule, "inDictionary" | "searchable">

// Subquery via the partial entries_drafts index so callers avoid joining entries just to exclude the few non-approved rows.
export const outsideScope = (db: DatabaseShape, scope: EntryScope) =>
  db
    .select({ id: entries.id })
    .from(entries)
    .where(notInArray(entries.review, reviewsWhere(scope)))
