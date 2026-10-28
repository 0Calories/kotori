import { at, Database, millis } from "@kotori/db"
import { cards, notes } from "@kotori/db/schema"
import {
  type AddNoteRequest,
  CardId,
  type CardSummary,
  type CardTemplate,
  type Note,
  NoteId,
  type Profile
} from "@kotori/domain"
import { and, eq, sql } from "drizzle-orm"
import { Clock, Effect } from "effect"
import { randomInt, randomUUID } from "node:crypto"

type NoteWithCards = typeof notes.$inferSelect & { readonly cards: ReadonlyArray<typeof cards.$inferSelect> }

const toSummary = (card: typeof cards.$inferSelect): CardSummary => ({
  id: CardId.make(card.id),
  template: card.template,
  queue: card.queue,
  due: millis(card.due),
  interval: card.interval,
  leech: card.leech
})

const toNote = (note: NoteWithCards): Note => ({
  id: NoteId.make(note.id),
  content: note.content,
  createdAt: millis(note.createdAt),
  cards: note.cards.map(toSummary)
})

const withCards = { cards: { orderBy: { template: "asc" } } } as const

/** The learner's notes, newest first, each with its cards. */
export const list = Effect.fn("study.notes")(function* (user: Profile) {
  const db = yield* Database
  const rows = yield* db.query.notes.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    with: withCards
  })
  return rows.map(toNote)
}, Effect.orDie)

/** Saves something to study, with a card per template. Saving the same dictionary sense twice returns the existing note. */
export const add = Effect.fn("study.addNote")(function* (user: Profile, request: AddNoteRequest) {
  const db = yield* Database
  const content = request.content
  const word = content.kind === "word" ? content : undefined
  if (word !== undefined) {
    const existing = yield* db.query.notes.findFirst({
      where: { userId: user.id, entryId: word.entryId, sense: word.senseIndex },
      with: withCards
    })
    if (existing !== undefined) return toNote(existing)
  }

  const now = at(yield* Clock.currentTimeMillis)
  const templates: ReadonlyArray<CardTemplate> =
    request.templates && request.templates.length > 0 ? [...new Set(request.templates)] : ["recognize", "produce"]
  const note = {
    id: randomUUID(),
    userId: user.id,
    kind: content.kind,
    content,
    entryId: word?.entryId ?? null,
    sense: word?.senseIndex ?? null,
    createdAt: now
  }
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // New cards are introduced in the order they were saved.
      const [last] = yield* tx
        .select({ next: sql<number>`coalesce(max(${cards.position}) + 1, 0)`.mapWith(Number) })
        .from(cards)
        .where(eq(cards.userId, user.id))
      const position = last?.next ?? 0
      yield* tx.insert(notes).values(note)
      const inserted = yield* tx
        .insert(cards)
        .values(
          templates.map((template) => ({
            noteId: note.id,
            userId: user.id,
            template,
            due: now,
            seed: randomInt(2 ** 31),
            position,
            createdAt: now
          }))
        )
        .returning()
      return toNote({ ...note, cards: inserted })
    })
  )
}, Effect.orDie)

/** Deletes a note and its cards; false if the learner has no such note. */
export const remove = Effect.fn("study.removeNote")(function* (user: Profile, id: NoteId) {
  const db = yield* Database
  const rows = yield* db
    .delete(notes)
    .where(and(eq(notes.userId, user.id), eq(notes.id, id)))
    .returning({ id: notes.id })
  return rows.length > 0
}, Effect.orDie)
