import { EntryId } from "@kotori/contracts"
import { englishEntryId } from "@kotori/db"
import { Effect, Schema } from "effect"
import type { DatabaseShape } from "../../../../db/Database.ts"
import { moveNotes, noteCountsOn } from "../../../notebook/queries.ts"
import { deleteEntries, lockEntries } from "../../queries.ts"
import type { ImportEntry } from "../seedFacts.ts"
import { addTo } from "./words.ts"

/**
 * When the import found notes in the way of deleting its stale words:
 * - `before-writing`: checking first, before it wrote anything. Nothing changed.
 * - `after-writing`: with the deletion, after it had written its words (in batches, each its own
 *   transaction), as a note was saved meanwhile. Its words stay written; only the stale words,
 *   and every note, are kept. Running the import again once the notes are dealt with finishes it.
 */
export const RefusalStage = Schema.Literals(["before-writing", "after-writing"])
export type RefusalStage = typeof RefusalStage.Type

/**
 * Words a complete English import would delete though learners have notes saved on them. The
 * import refuses to delete them (a note cascades with its word); see `RefusalStage` for what
 * it had written by then.
 */
export class NotedEntriesWouldBeDeleted extends Schema.TaggedError<NotedEntriesWouldBeDeleted>()(
  "NotedEntriesWouldBeDeleted",
  {
    message: Schema.String,
    stage: RefusalStage,
    entries: Schema.Array(Schema.Struct({ entryId: EntryId, notes: Schema.Number }))
  }
) {}

const whatChanged = (stage: RefusalStage) => {
  switch (stage) {
    case "before-writing":
      return "Nothing was written."
    case "after-writing":
      return "The import's words were written; the words it no longer has were kept, with their notes."
  }
}

/**
 * The entry each stale word lives on as a spelling, when exactly one does: "en:Spartan" in
 * "en:spartan" once the twins fold. Failing a spelling, the one entry whose headword differs
 * from it only by case: "en:ipod" is now "en:iPod". A spelling several entries share, or a
 * word several entries are spelled like but for case ("en:ev": "EV", "eV"), names none.
 */
export const successorsOf = (
  entries: ReadonlyArray<ImportEntry>,
  stale: ReadonlyArray<EntryId>
): ReadonlyMap<EntryId, EntryId> => {
  // By the id the spelling would have as a headword of its own.
  const owners = new Map<EntryId, Set<EntryId>>()
  // By the headword lowercased: "en:ipod" is "en:iPod" written in another case.
  const recased = new Map<string, Set<EntryId>>()
  for (const entry of entries) {
    addTo(recased, englishEntryId(entry.headword).toLowerCase(), entry.id)
    for (const form of entry.forms) {
      if (form.kind === "spelling" && form.text !== entry.headword) addTo(owners, englishEntryId(form.text), entry.id)
    }
  }
  const successors = new Map<EntryId, EntryId>()
  for (const id of stale) {
    const [only, ...others] = owners.get(id) ?? recased.get(id.toLowerCase()) ?? []
    if (only !== undefined && others.length === 0) successors.set(id, only)
  }
  return successors
}

/** Fails when a note is saved on a word about to go that no successor takes the notes of. */
const refuseNoted = (
  counts: ReadonlyMap<EntryId, number>,
  successors: ReadonlyMap<EntryId, EntryId>,
  stage: RefusalStage
) => {
  const noted = [...counts]
    .filter(([entryId]) => !successors.has(entryId))
    .map(([entryId, notes]) => ({ entryId, notes }))
    .toSorted((a, b) => (a.entryId < b.entryId ? -1 : 1))
  if (noted.length === 0) return Effect.void
  const list = noted.map(({ entryId, notes }) => `${entryId} (${notes} ${notes === 1 ? "note" : "notes"})`)
  return Effect.fail(
    new NotedEntriesWouldBeDeleted({
      message: `The English import would delete ${noted.length} words learners saved: ${list.join(", ")}. ${whatChanged(stage)}`,
      stage,
      entries: noted
    })
  )
}

/** Fails, before the import writes anything, when a note is saved on a stale word no successor takes. */
export const refuseBeforeWriting = Effect.fn("EnglishDictionary.refuseBeforeWriting")(function* (
  db: DatabaseShape,
  stale: ReadonlyArray<EntryId>,
  successors: ReadonlyMap<EntryId, EntryId>
) {
  yield* refuseNoted(yield* noteCountsOn(db, stale), successors, "before-writing")
})

/** Fails when any note at all is saved on a word about to go: the notes that could move have. */
const refuseAnyNoted = (counts: ReadonlyMap<EntryId, number>) => refuseNoted(counts, new Map(), "after-writing")

/**
 * Deletes the stale words in one transaction, each successor first taking the notes on the
 * word it replaces, and refusing if a note is still saved on any of them.
 *
 * Only this step is one transaction; the words were written before it, in batches. Writing all
 * ~80k of them in this transaction too would make a refusal undo them, but holds every row it
 * rewrites, and their search rows, until the slowest step commits, for an outcome no safer: a
 * refused deletion keeps the stale words and their notes, and the next import finishes the job.
 */
export const removeStale = Effect.fn("EnglishDictionary.removeStale")(function* (
  db: DatabaseShape,
  stale: ReadonlyArray<EntryId>,
  successors: ReadonlyMap<EntryId, EntryId>
) {
  yield* db.transaction(() =>
    Effect.gen(function* () {
      // A note saved on one of these words now waits for the transaction, so none is saved
      // between the count and the deletion, nor onto a successor while notes move to it.
      yield* lockEntries(db, [...new Set([...stale, ...successors.values()])])
      for (const [from, to] of successors) {
        const { moved, dropped } = yield* moveNotes(db, from, to)
        if (moved + dropped > 0) {
          yield* Effect.logInfo(
            `Moved ${moved} notes from ${from} to ${to}; ${dropped} dropped, already saved on ${to}`
          )
        }
      }
      // Notes saved since the first check, before the lock, are counted again.
      yield* refuseAnyNoted(yield* noteCountsOn(db, stale))
      yield* deleteEntries(db, stale)
    })
  )
})
