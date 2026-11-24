import { type AddNoteRequest, InvalidRequest, type Note, NoteId, NotFound, type Profile } from "@kotori/contracts"
import { Clock, Context, Effect, Layer, Match, Option } from "effect"
import { randomUUID } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { type Learner, scopedToUser } from "../../db/scopedToUser.ts"
import { getEntryDocuments } from "../dictionary/index.ts"
import { allNotes, deleteNote, insertNote, noteByEntry, type NoteDeletion, type NoteRow } from "./queries.ts"

export class Notebook extends Context.Service<
  Notebook,
  {
    notes(user: Profile): Effect.Effect<ReadonlyArray<Note>>
    addNote(user: Profile, request: AddNoteRequest): Effect.Effect<Note, NotFound | InvalidRequest>
    removeNote(user: Profile, id: NoteId): Effect.Effect<NoteDeletion>
  }
>()("@kotori/backend/Notebook") {
  static readonly layer = Layer.effect(
    Notebook,
    Effect.gen(function* () {
      const db = yield* Database
      const learnerOf = (user: Profile): Learner => scopedToUser(db, user.id)

      const toNotes = Effect.fnUntraced(function* (rows: ReadonlyArray<NoteRow>) {
        const ids = [...new Set(rows.map((row) => row.entryId))]
        const docs = yield* getEntryDocuments(db, ids)
        const byId = new Map(docs.map((doc) => [doc.id, doc]))
        return rows.flatMap((row): Array<Note> => {
          const doc = byId.get(row.entryId)
          if (doc === undefined) return []
          return [
            {
              id: row.id,
              createdAt: row.createdAt,
              entry: {
                id: doc.id,
                language: doc.language,
                source: doc.source,
                reviewState: doc.reviewState,
                headword: doc.base.headword,
                reading: doc.base.reading
              },
              senses: doc.base.senses.map((sense) => ({
                glosses: sense.glosses.map((g) => g.text)
              }))
            }
          ]
        })
      })

      const toNote = (row: NoteRow) =>
        toNotes([row]).pipe(
          Effect.flatMap((rows) =>
            rows[0] === undefined ? Effect.die(new Error(`Note ${row.id} has no entry`)) : Effect.succeed(rows[0])
          )
        )

      const notes = Effect.fn("Notebook.notes")(function* (user: Profile) {
        return yield* toNotes(yield* allNotes(learnerOf(user)))
      })

      const addNote = Effect.fn("Notebook.addNote")(function* (user: Profile, request: AddNoteRequest) {
        const learner = learnerOf(user)
        const [entry] = yield* getEntryDocuments(db, [request.entryId])
        if (entry === undefined) return yield* new NotFound({ message: "No such entry" })

        const existing = yield* noteByEntry(learner, entry.id)
        if (Option.isSome(existing)) return yield* toNote(existing.value)

        const saveable = Match.value(entry.reviewState).pipe(
          Match.when("approved", () => true),
          Match.when("unreviewed", () => true),
          Match.when("discarded", () => false),
          Match.exhaustive
        )
        if (!saveable) {
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
