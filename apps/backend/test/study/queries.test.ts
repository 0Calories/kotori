import { assert, layer } from "@effect/vitest"
import { NoteId, UserId } from "@kotori/contracts"
import { reviewLogs } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Effect, Exit, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import {
  allNotes,
  countReviewed,
  deleteNote,
  insertNote,
  learningDue,
  type NewNote,
  newNotes,
  nextLearningDue,
  nextPosition,
  noteById,
  noteCount,
  retention,
  reviewDue,
  reviewDueTimes,
  saveReview,
  stageCounts,
  studyDays
} from "../../src/features/study/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { learner, N1, N2, N3, U1 } from "../fixtures.ts"

const at = (ms: number) => new Date(ms)

const U2 = UserId.make("00000000-0000-4000-8000-000000000002")

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

/** A phrase note at a retention stage, due at `due`. */
const note = (
  id: NoteId,
  text: string,
  retentionStage: NonNullable<NewNote["retentionStage"]>,
  due: number,
  position = 0
): NewNote & { readonly id: NoteId } => ({
  id,
  kind: "phrase",
  content: phrase(text),
  entryId: null,
  sense: null,
  retentionStage,
  due: at(due),
  interval: retentionStage === "review" ? 3 : 0,
  ease: retentionStage === "review" ? 2.5 : 0,
  seed: 7,
  position,
  createdAt: at(position)
})

const review = {
  rating: "again",
  retentionStageBefore: "review",
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
  it.effect("stores notes with their schedule and serves the due ones by retention stage", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)

      yield* insertNote(own, note(N1, "お疲れ様です", "new", 0, 0))
      yield* insertNote(own, note(N2, "いただきます", "review", 500, 1))
      yield* insertNote(own, note(N3, "すみません", "learning", 700, 2))

      assert.deepStrictEqual(
        (yield* allNotes(own)).map((n) => n.id),
        [N3, N2, N1]
      )
      assert.deepStrictEqual(
        (yield* newNotes(own, 10)).map((n) => n.id),
        [N1]
      )
      assert.deepStrictEqual(
        (yield* reviewDue(own, at(1000), 10)).map((n) => n.id),
        [N2]
      )
      assert.deepStrictEqual(yield* reviewDue(own, at(100), 10), [])
      assert.deepStrictEqual(
        (yield* learningDue(own, at(1000))).map((n) => n.id),
        [N3]
      )
      assert.deepStrictEqual(yield* learningDue(own, at(100)), [])
      assert.deepStrictEqual(Option.getOrThrow(yield* nextLearningDue(own)), at(700))

      const loaded = Option.getOrThrow(yield* noteById(own, N2))
      assert.strictEqual(loaded.content.kind, "phrase")
      assert.isTrue(yield* saveReview(own, N2, { due: at(99_999), interval: 8 }, review))
      assert.strictEqual(Option.getOrThrow(yield* noteById(own, N2)).interval, 8)

      // Reviews are logged per study day and feed the statistics.
      assert.isTrue(
        yield* saveReview(
          own,
          N1,
          { reps: 1 },
          {
            ...review,
            rating: "good",
            retentionStageBefore: "new",
            intervalBefore: 0,
            interval: 0,
            easeBefore: 0,
            ease: 2.5
          }
        )
      )
      assert.strictEqual(yield* countReviewed(own, 20_000), 2)
      assert.strictEqual(yield* countReviewed(own, 20_000, "new"), 1)
      assert.deepStrictEqual(yield* studyDays(own), [20_000])
      assert.deepStrictEqual(yield* retention(own, 19_000), { total: 1, failed: 1 })
      assert.deepStrictEqual(
        (yield* stageCounts(own)).map((row) => `${row.retentionStage}:${row.mature}:${row.n}`).sort(),
        ["learning:false:1", "new:false:1", "review:false:1"]
      )
      assert.strictEqual(yield* nextPosition(own), 3)
      assert.deepStrictEqual(yield* reviewDueTimes(own, at(100_000)), [at(99_999)])

      assert.strictEqual(yield* deleteNote(own, N2), "deleted")
      assert.isTrue(Option.isNone(yield* noteById(own, N2)))
      assert.strictEqual(yield* noteCount(own), 2)
      yield* deleteNote(own, N1)
      yield* deleteNote(own, N3)
    })
  )

  it.effect("keeps each learner to their own notes and reviews", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* ensureUser(db, { ...learner, id: U2 })
      const own = scopedToUser(db, U1)
      const other = scopedToUser(db, U2)
      yield* insertNote(own, note(N1, "いただきます", "review", 0))

      assert.deepStrictEqual(yield* allNotes(other), [])
      assert.isTrue(Option.isNone(yield* noteById(other, N1)))
      assert.deepStrictEqual(yield* reviewDue(other, at(1000), 10), [])
      assert.strictEqual(yield* noteCount(other), 0)
      // Neither deleting nor reviewing reaches another learner's data.
      assert.strictEqual(yield* deleteNote(other, N1), "forbidden")
      assert.isFalse(yield* saveReview(other, N1, { interval: 30 }, review))
      assert.strictEqual(Option.getOrThrow(yield* noteById(own, N1)).interval, 3)
      assert.strictEqual(yield* countReviewed(other, review.studyDay), 0)
      assert.strictEqual(yield* countReviewed(own, review.studyDay), 0)

      assert.strictEqual(yield* deleteNote(own, N1), "deleted")
    })
  )

  it.effect("deletes a note and its review logs only for the owner, and accepts missing notes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* ensureUser(db, { ...learner, id: U2 })
      const own = scopedToUser(db, U1)
      const other = scopedToUser(db, U2)
      const removedId = NoteId.make("00000000-0000-4000-8000-00000000000d")
      const keptId = NoteId.make("00000000-0000-4000-8000-00000000000e")
      yield* insertNote(own, note(removedId, "いただきます", "review", 0))
      yield* insertNote(other, note(keptId, "ごちそうさま", "review", 0))
      yield* saveReview(own, removedId, { reps: 1 }, review)
      yield* saveReview(own, removedId, { reps: 2 }, review)
      yield* saveReview(other, keptId, { reps: 1 }, review)
      const logsFor = (noteId: NoteId) => db.$count(reviewLogs, eq(reviewLogs.noteId, noteId))

      assert.strictEqual(yield* deleteNote(other, removedId), "forbidden")
      assert.isTrue(Option.isSome(yield* noteById(own, removedId)))
      assert.strictEqual(yield* logsFor(removedId), 2)

      assert.strictEqual(yield* deleteNote(own, removedId), "deleted")
      assert.isTrue(Option.isNone(yield* noteById(own, removedId)))
      assert.strictEqual(yield* logsFor(removedId), 0)
      assert.isTrue(Option.isSome(yield* noteById(other, keptId)))
      assert.strictEqual(yield* logsFor(keptId), 1)
      assert.strictEqual(yield* deleteNote(own, removedId), "absent")
      assert.strictEqual(yield* deleteNote(own, NoteId.make("00000000-0000-4000-8000-000000000099")), "absent")
      yield* deleteNote(other, keptId)
    })
  )

  it.effect("records a review's new schedule and its log, or neither", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)
      yield* insertNote(own, note(N1, "ごめんなさい", "review", 0))
      // A log the database refuses (no study day), written after the note was updated.
      const reviewed = yield* saveReview(own, N1, { interval: 30 }, { ...review, studyDay: null as never }).pipe(
        Effect.exit
      )
      assert.isTrue(Exit.isFailure(reviewed))
      assert.strictEqual(Option.getOrThrow(yield* noteById(own, N1)).interval, 3)
      assert.strictEqual(yield* countReviewed(own, review.studyDay), 0)

      assert.strictEqual(yield* deleteNote(own, N1), "deleted")
    })
  )
})
