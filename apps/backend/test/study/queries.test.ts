import { assert, layer } from "@effect/vitest"
import { CardId, NoteId, UserId } from "@kotori/contracts"
import { reviewLogs } from "@kotori/db"
import { count, eq, sql } from "drizzle-orm"
import { Effect, Exit, Option } from "effect"
import { readFileSync } from "node:fs"
import { Database } from "../../src/db/Database.ts"
import { migrationsFolder } from "../../src/db/Migrate.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import {
  answerCard,
  cardWithContent,
  countAnswers,
  deleteNote,
  insertNote,
  learningDue,
  type NewCard,
  newCards,
  nextPosition,
  noteCount,
  notesWithCards,
  queueCounts,
  retention,
  reviewDue,
  reviewDueTimes,
  studyDays
} from "../../src/features/study/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { C1, C2, C3, C4, C5, C6, learner, N1, N2, U1 } from "../fixtures.ts"

const at = (ms: number) => new Date(ms)

const U2 = UserId.make("00000000-0000-4000-8000-000000000002")

const card = (
  id: CardId,
  queue: NewCard["queue"],
  due: number,
  template: NewCard["template"] = "recognize"
): NewCard => ({
  id,
  template,
  queue,
  due: at(due),
  interval: queue === "review" ? 3 : 0,
  ease: queue === "review" ? 2.5 : 0,
  seed: 7,
  position: 0,
  createdAt: at(0)
})

const phrase = (text: string) =>
  ({
    kind: "phrase",
    text,
    furigana: null,
    meaning: text,
    note: null,
    register: "polite",
    source: "manual"
  }) as const

const answer = {
  rating: "again",
  queueBefore: "review",
  intervalBefore: 3,
  interval: 1,
  easeBefore: 2.5,
  ease: 2.3,
  delayMs: 500,
  durationMs: 4200,
  reviewedAt: at(1000),
  studyDay: 20_000
} as const

layer(DatabaseMemory)("study queries", (it) => {
  it.effect("stores notes with cards and serves due queues", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)

      yield* insertNote(
        own,
        { id: N1, kind: "phrase", content: phrase("お疲れ様です"), entryId: null, sense: null, createdAt: at(0) },
        [card(C1, "new", 0), card(C2, "review", 500)]
      )

      const notes = yield* notesWithCards(own)
      assert.strictEqual(notes.length, 1)
      assert.strictEqual(notes[0]?.cards.length, 2)

      assert.deepStrictEqual(
        (yield* newCards(own, 10)).map((c) => c.id),
        [C1]
      )
      assert.deepStrictEqual(
        (yield* reviewDue(own, at(1000), 10)).map((c) => c.id),
        [C2]
      )
      assert.deepStrictEqual(yield* reviewDue(own, at(100), 10), [])

      const loaded = Option.getOrThrow(yield* cardWithContent(own, C2))
      assert.strictEqual(loaded.content.kind, "phrase")
      assert.isTrue(yield* answerCard(own, C2, { due: at(99_999), interval: 8 }, answer))
      assert.strictEqual(Option.getOrThrow(yield* cardWithContent(own, C2)).interval, 8)

      // Answers are logged per study day and feed the statistics.
      assert.isTrue(
        yield* answerCard(
          own,
          C1,
          { reps: 1 },
          { ...answer, rating: "good", queueBefore: "new", intervalBefore: 0, interval: 0, easeBefore: 0, ease: 2.5 }
        )
      )
      assert.strictEqual(yield* countAnswers(own, 20_000), 2)
      assert.strictEqual(yield* countAnswers(own, 20_000, "new"), 1)
      assert.deepStrictEqual(yield* studyDays(own), [20_000])
      assert.deepStrictEqual(yield* retention(own, 19_000), { total: 1, failed: 1 })
      assert.deepStrictEqual((yield* queueCounts(own)).map((row) => `${row.queue}:${row.mature}:${row.n}`).sort(), [
        "new:false:1",
        "review:false:1"
      ])
      assert.strictEqual(yield* nextPosition(own), 1)
      assert.deepStrictEqual(yield* reviewDueTimes(own, at(100_000)), [at(99_999)])

      assert.strictEqual(yield* deleteNote(own, N1), "deleted")
      assert.isTrue(Option.isNone(yield* cardWithContent(own, C2)))
      assert.strictEqual(yield* noteCount(own), 0)
    })
  )

  it.effect("keeps each learner to their own notes, cards and answers", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* ensureUser(db, { ...learner, id: U2 })
      const own = scopedToUser(db, U1)
      const other = scopedToUser(db, U2)
      yield* insertNote(
        own,
        { id: N1, kind: "phrase", content: phrase("いただきます"), entryId: null, sense: null, createdAt: at(0) },
        [card(C1, "review", 0)]
      )

      assert.deepStrictEqual(yield* notesWithCards(other), [])
      assert.isTrue(Option.isNone(yield* cardWithContent(other, C1)))
      assert.deepStrictEqual(yield* reviewDue(other, at(1000), 10), [])
      assert.strictEqual(yield* noteCount(other), 0)
      // Neither deleting nor answering reaches another learner's data.
      assert.strictEqual(yield* deleteNote(other, N1), "forbidden")
      assert.isFalse(yield* answerCard(other, C1, { interval: 30 }, answer))
      assert.strictEqual(Option.getOrThrow(yield* cardWithContent(own, C1)).interval, 3)
      assert.strictEqual(yield* countAnswers(other, answer.studyDay), 0)
      assert.strictEqual(yield* countAnswers(own, answer.studyDay), 0)

      assert.strictEqual(yield* deleteNote(own, N1), "deleted")
    })
  )

  it.effect("deletes every card and review log only for the owner, and accepts missing notes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* ensureUser(db, { ...learner, id: U2 })
      const own = scopedToUser(db, U1)
      const other = scopedToUser(db, U2)
      const removedId = NoteId.make("00000000-0000-4000-8000-00000000000d")
      const keptId = NoteId.make("00000000-0000-4000-8000-00000000000e")
      const removedCards = [
        CardId.make("00000000-0000-4000-8000-0000000000c7"),
        CardId.make("00000000-0000-4000-8000-0000000000c8")
      ]
      const keptCard = CardId.make("00000000-0000-4000-8000-0000000000c9")
      yield* insertNote(own, { id: removedId, kind: "phrase", content: phrase("いただきます"), createdAt: at(0) }, [
        card(removedCards[0]!, "review", 0),
        card(removedCards[1]!, "review", 0, "produce")
      ])
      yield* insertNote(other, { id: keptId, kind: "phrase", content: phrase("ごちそうさま"), createdAt: at(0) }, [
        card(keptCard, "review", 0)
      ])
      for (const cardId of removedCards) yield* answerCard(own, cardId, { reps: 1 }, answer)
      yield* answerCard(other, keptCard, { reps: 1 }, answer)
      const logsFor = (cardId: CardId) => db.$count(reviewLogs, eq(reviewLogs.cardId, cardId))

      assert.strictEqual(yield* deleteNote(other, removedId), "forbidden")
      assert.isTrue((yield* notesWithCards(own)).some((note) => note.id === removedId))
      for (const cardId of removedCards) {
        assert.isTrue(Option.isSome(yield* cardWithContent(own, cardId)))
        assert.strictEqual(yield* logsFor(cardId), 1)
      }

      assert.strictEqual(yield* deleteNote(own, removedId), "deleted")
      assert.isFalse((yield* notesWithCards(own)).some((note) => note.id === removedId))
      for (const cardId of removedCards) {
        assert.isTrue(Option.isNone(yield* cardWithContent(own, cardId)))
        assert.strictEqual(yield* logsFor(cardId), 0)
      }
      assert.isTrue(Option.isSome(yield* cardWithContent(other, keptCard)))
      assert.strictEqual(yield* logsFor(keptCard), 1)
      assert.strictEqual(yield* deleteNote(own, removedId), "absent")
      assert.strictEqual(yield* deleteNote(own, NoteId.make("00000000-0000-4000-8000-000000000099")), "absent")
      yield* deleteNote(other, keptId)
    })
  )

  it.effect("saves a note and its cards, or neither", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)
      // The second card reuses the first one's id, so inserting the cards fails after the note is in.
      const saved = yield* insertNote(
        own,
        { id: N1, kind: "phrase", content: phrase("すみません"), entryId: null, sense: null, createdAt: at(0) },
        [card(C1, "new", 0), card(C1, "new", 0)]
      ).pipe(Effect.exit)
      assert.isTrue(Exit.isFailure(saved))
      assert.deepStrictEqual(yield* notesWithCards(own), [])
    })
  )

  it.effect("records an answer's new card state and its log, or neither", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)
      yield* insertNote(
        own,
        { id: N1, kind: "phrase", content: phrase("ごめんなさい"), entryId: null, sense: null, createdAt: at(0) },
        [card(C1, "review", 0)]
      )
      // A log the database refuses (no study day), written after the card was updated.
      const answered = yield* answerCard(own, C1, { interval: 30 }, { ...answer, studyDay: null as never }).pipe(
        Effect.exit
      )
      assert.isTrue(Exit.isFailure(answered))
      assert.strictEqual(Option.getOrThrow(yield* cardWithContent(own, C1)).interval, 3)
      assert.strictEqual(yield* countAnswers(own, answer.studyDay), 0)

      assert.strictEqual(yield* deleteNote(own, N1), "deleted")
    })
  )

  it.effect("deletes reverse cards and their review logs, and leaves recognize cards", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)

      yield* insertNote(
        own,
        { id: N2, kind: "phrase", content: phrase("ありがとう"), entryId: null, sense: null, createdAt: at(0) },
        [
          card(C3, "new", 0),
          card(C4, "new", 0, "produce"),
          card(C5, "learning", 50, "produce"),
          card(C6, "review", 100, "produce")
        ]
      )

      // Logged as the reverse cards were answered before the migration; there is no query for
      // answering a reverse card any more, so the rows go in directly.
      const log = { userId: U1, intervalBefore: 0, interval: 0, easeBefore: 0, ease: 0, delayMs: 0, durationMs: null }
      yield* db.insert(reviewLogs).values([
        { ...log, cardId: C3, rating: "good", queueBefore: "new", reviewedAt: at(30_000), studyDay: 30_000 },
        { ...log, cardId: C4, rating: "easy", queueBefore: "new", reviewedAt: at(31_000), studyDay: 31_000 },
        {
          ...log,
          cardId: C6,
          rating: "again",
          queueBefore: "review",
          intervalBefore: 10,
          interval: 1,
          reviewedAt: at(31_000),
          studyDay: 31_000
        }
      ])

      const logsFor = (cardId: CardId) =>
        db
          .select({ n: count() })
          .from(reviewLogs)
          .where(eq(reviewLogs.cardId, cardId))
          .pipe(Effect.map((rows) => rows[0]?.n ?? 0))

      // The migration file itself, split the way the migrator runs it.
      const dropReverseCards = Effect.gen(function* () {
        const file = readFileSync(`${migrationsFolder}/20261102001220_drop_reverse_cards/migration.sql`, "utf8")
        for (const statement of file.split("--> statement-breakpoint")) {
          const text = statement.trim()
          if (text.length > 0) yield* db.execute(sql.raw(text))
        }
      })

      yield* dropReverseCards

      assert.strictEqual(Option.getOrThrow(yield* cardWithContent(own, C3)).template, "recognize")
      assert.isTrue(Option.isNone(yield* cardWithContent(own, C4)))
      assert.isTrue(Option.isNone(yield* cardWithContent(own, C5)))
      assert.isTrue(Option.isNone(yield* cardWithContent(own, C6)))
      assert.strictEqual(yield* logsFor(C3), 1)
      assert.strictEqual(yield* logsFor(C4), 0)
      assert.strictEqual(yield* logsFor(C6), 0)
      assert.deepStrictEqual(yield* studyDays(own), [30_000])
      assert.strictEqual(yield* countAnswers(own, 30_000), 1)
      assert.strictEqual(yield* countAnswers(own, 31_000), 0)
      assert.deepStrictEqual(
        (yield* newCards(own, 10)).map((c) => c.id),
        [C3]
      )
      assert.deepStrictEqual(yield* reviewDue(own, at(1_000), 10), [])
      assert.deepStrictEqual(yield* learningDue(own, at(1_000)), [])
      assert.deepStrictEqual(
        (yield* queueCounts(own)).map((row) => `${row.queue}:${row.mature}:${row.n}`),
        ["new:false:1"]
      )
      const note = (yield* notesWithCards(own)).find((row) => row.id === N2)
      assert.deepStrictEqual(
        note?.cards.map((c) => c.id),
        [C3]
      )

      // Idempotent: running it again does not touch the recognize card or its log.
      yield* dropReverseCards
      assert.strictEqual(Option.getOrThrow(yield* cardWithContent(own, C3)).template, "recognize")
      assert.strictEqual(yield* logsFor(C3), 1)

      assert.strictEqual(yield* deleteNote(own, N2), "deleted")
    })
  )
})
