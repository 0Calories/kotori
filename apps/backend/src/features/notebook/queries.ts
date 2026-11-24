import { type EntryId, type NoteId, notes } from "@kotori/db"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { Effect, Option } from "effect"
import { chunks } from "../../db/chunks.ts"
import type { DatabaseShape } from "../../db/Database.ts"
import type { Learner } from "../../db/scopedToUser.ts"

/** How many notes each of `entryIds` is saved in, for those saved in any, across learners. */
export const noteCountsOn = Effect.fn("notebook.noteCountsOn")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  const counts = new Map<EntryId, number>()
  for (const chunk of chunks(entryIds, 5000)) {
    const rows = yield* db
      .select({ entryId: notes.entryId, notes: count() })
      .from(notes)
      .where(inArray(notes.entryId, [...chunk]))
      .groupBy(notes.entryId)
    for (const row of rows) counts.set(row.entryId, row.notes)
  }
  return counts
}, Effect.orDie)

/**
 * Moves every learner's note on `from` to `to`, as when a word becomes another's spelling. A
 * learner with a note on `to` already keeps that one, and the note on `from` goes: the word
 * stays saved. Returns how many notes moved and how many went.
 */
export const moveNotes = Effect.fn("notebook.moveNotes")(function* (db: DatabaseShape, from: EntryId, to: EntryId) {
  const savedOnTo = db.select({ userId: notes.userId }).from(notes).where(eq(notes.entryId, to))
  // (userId, entryId) is unique, so a learner's second note on the same word can't move; it goes, the word stays saved.
  const dropped = yield* db
    .delete(notes)
    .where(and(eq(notes.entryId, from), inArray(notes.userId, savedOnTo)))
    .returning({ id: notes.id })
  const moved = yield* db.update(notes).set({ entryId: to }).where(eq(notes.entryId, from)).returning({ id: notes.id })
  return { moved: moved.length, dropped: dropped.length }
}, Effect.orDie)

export type NoteRow = typeof notes.$inferSelect

export type NewNote = Omit<typeof notes.$inferInsert, "userId">

export const insertNote = Effect.fn("notebook.insertNote")(function* (
  learner: Learner,
  note: NewNote & { readonly id: NoteId }
) {
  yield* learner.db
    .insert(notes)
    .values({ ...note, userId: learner.userId })
    .onConflictDoNothing({ target: [notes.userId, notes.entryId] })
  return Option.getOrThrow(yield* noteByEntry(learner, note.entryId))
}, Effect.orDie)

export const allNotes = (learner: Learner) =>
  learner.db.select().from(notes).where(learner.owns(notes)).orderBy(desc(notes.createdAt)).pipe(Effect.orDie)

export const noteByEntry = (learner: Learner, entryId: EntryId) =>
  learner.db
    .select()
    .from(notes)
    .where(learner.owns(notes, eq(notes.entryId, entryId)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

export type NoteDeletion = "deleted" | "absent" | "forbidden"

export const deleteNote = Effect.fn("notebook.deleteNote")(function* (learner: Learner, noteId: NoteId) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      const [found] = yield* db.select({ userId: notes.userId }).from(notes).where(eq(notes.id, noteId)).limit(1)
      if (found === undefined) return "absent" as const
      if (found.userId !== userId) return "forbidden" as const

      const removed = yield* db
        .delete(notes)
        .where(learner.owns(notes, eq(notes.id, noteId)))
        .returning({ id: notes.id })
      return removed.length > 0 ? ("deleted" as const) : ("absent" as const)
    })
  )
}, Effect.orDie)

export const noteCount = (learner: Learner) => learner.db.$count(notes, learner.owns(notes)).pipe(Effect.orDie)
