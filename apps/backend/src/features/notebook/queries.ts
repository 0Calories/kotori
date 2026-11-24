import { type EntryId, type NoteId, notes } from "@kotori/db"
import { desc, eq } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { Learner } from "../../db/scopedToUser.ts"

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
