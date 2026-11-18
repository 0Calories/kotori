import {
  type AddNoteRequest,
  InvalidRequest,
  type Note,
  NoteId,
  NotFound,
  type Profile,
  REVIEW_RULES
} from "@kotori/contracts"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { randomUUID } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { type Learner, scopedToUser } from "../../db/scopedToUser.ts"
import { getEntries, notedEntries } from "../dictionary/index.ts"
import { allNotes, deleteNote, insertNote, noteByEntry, type NoteDeletion, type NoteRow } from "./queries.ts"

export class Notebook extends Context.Service<
  Notebook,
  {
    notes(user: Profile): Effect.Effect<ReadonlyArray<Note>>
    /** Saves a dictionary entry to the learner's notebook; see `AddNoteRequest`. */
    addNote(user: Profile, request: AddNoteRequest): Effect.Effect<Note, NotFound | InvalidRequest>
    removeNote(user: Profile, id: NoteId): Effect.Effect<NoteDeletion>
  }
>()("@kotori/backend/Notebook") {
  static readonly layer = Layer.effect(
    Notebook,
    Effect.gen(function* () {
      const db = yield* Database
      const learnerOf = (user: Profile): Learner => scopedToUser(db, user.id)

      /**
       * Notes as the app reads them: each with its entry as the dictionary has it now. A list of
       * them costs the same few queries as one.
       */
      const toNotes = Effect.fnUntraced(function* (rows: ReadonlyArray<NoteRow>) {
        const noted = yield* notedEntries(
          db,
          rows.map((row) => row.entryId)
        )
        return rows.flatMap((row): Array<Note> => {
          const found = noted.get(row.entryId)
          // The foreign key cascades, so a note always has its entry; one deleted mid-read is left out.
          if (found === undefined) return []
          return [
            {
              id: row.id,
              createdAt: row.createdAt,
              entry: found.entry,
              senses: found.senses
            }
          ]
        })
      })
      const toNote = (row: NoteRow) =>
        toNotes([row]).pipe(
          Effect.flatMap((notes) =>
            notes[0] === undefined ? Effect.die(new Error(`Note ${row.id} has no entry`)) : Effect.succeed(notes[0])
          )
        )

      const notes = Effect.fn("Notebook.notes")(function* (user: Profile) {
        return yield* toNotes(yield* allNotes(learnerOf(user)))
      })

      const addNote = Effect.fn("Notebook.addNote")(function* (user: Profile, request: AddNoteRequest) {
        const learner = learnerOf(user)
        const [entry] = yield* getEntries(db, [request.entryId])
        if (entry === undefined) return yield* new NotFound({ message: "No such entry" })

        const existing = yield* noteByEntry(learner, entry.id)
        if (Option.isSome(existing)) return yield* toNote(existing.value)

        // A discarded draft stays in the notebook of whoever saved it, but no one saves it anew.
        if (!REVIEW_RULES[entry.review].saveable) {
          return yield* new InvalidRequest({ message: "That entry isn't in the dictionary" })
        }
        const now = new Date(yield* Clock.currentTimeMillis)
        const saved = yield* insertNote(learner, {
          id: NoteId.make(randomUUID()),
          entryId: entry.id,
          createdAt: now
        })
        return yield* toNote(saved)
      })

      const removeNote = (user: Profile, id: NoteId) => deleteNote(learnerOf(user), id)

      return Notebook.of({ notes, addNote, removeNote })
    })
  )
}
