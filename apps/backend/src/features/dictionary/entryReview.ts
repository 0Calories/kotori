import { entries, type EntryId, type EntryReview, type ReviewRule, reviewsWhere } from "@kotori/db"
import { and, inArray, notInArray } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

/**
 * An entry's review lifecycle: every move it makes, the states it is made from and the one it
 * leads to. An entry in any other state is left as it is. Imports insert `approved` entries and
 * Ask Kotori inserts its drafts `unreviewed`; from there only these moves change the state.
 *
 * ```text
 * (no entry) ──draft──▶ unreviewed ──approve──▶ approved ◀──import── (no entry)
 *                            └───────discard──▶ discarded
 * ```
 */
const MOVES = {
  /** The admin accepts a draft into the dictionary. */
  approve: { from: ["unreviewed"], to: "approved" },
  /** The admin turns a draft down: hidden from search, kept for the learners who saved it. */
  discard: { from: ["unreviewed"], to: "discarded" }
} as const satisfies Record<string, { readonly from: ReadonlyArray<EntryReview>; readonly to: EntryReview }>

export type ReviewMove = keyof typeof MOVES

/** Makes `move` on the entries that can make it, returning the ids it moved. */
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

/** Entries `rule` holds for, as a filter on `entries`. */
export const reviewedAs = (rule: ReviewRule) => inArray(entries.review, reviewsWhere(rule))

/**
 * Which entries a dictionary read sees: the dictionary proper (`inDictionary`), or every
 * `searchable` one, Kotori's unreviewed drafts too.
 */
export type EntryScope = Extract<ReviewRule, "inDictionary" | "searchable">

/**
 * Entry ids outside `scope`. Only drafts are ever outside, and they are few, so this reads them
 * through their partial index (`entries_drafts`) rather than joining every entry.
 */
export const outsideScope = (db: DatabaseShape, scope: EntryScope) =>
  db
    .select({ id: entries.id })
    .from(entries)
    .where(notInArray(entries.review, reviewsWhere(scope)))
