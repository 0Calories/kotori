import { assert, layer } from "@effect/vitest"
import { CardId, EntryId, type Profile } from "@kotori/domain"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import { Accounts, Dictionary, Study } from "../src/index.ts"
import { TestAuth } from "../src/testing.ts"
import { entry, sense, servicesWith } from "./fixtures.ts"

const DAY = 24 * 60 * 60 * 1000

const learner = (email: string) =>
  Effect.gen(function* () {
    const { cookie } = yield* (yield* TestAuth).signUp(email, "Learner")
    const user = Option.getOrThrow(yield* (yield* TestAuth).userForCookie(cookie))
    return yield* Accounts.profile(user)
  })

const word = (senseIndex: number) => ({
  kind: "word" as const,
  entryId: EntryId.make(1358280),
  senseIndex,
  headword: "食べる",
  reading: "たべる",
  meaning: "to eat",
  hint: null,
  example: null,
  audioUrl: null
})

const phrase = {
  kind: "phrase" as const,
  text: "お疲れ様です",
  furigana: "お{疲|つか}れ{様|さま}です",
  meaning: "Thanks for your hard work",
  note: null,
  register: "polite" as const,
  source: "manual" as const
}

layer(servicesWith())("Study", (it) => {
  it.effect("saves notes with a card per template, once per dictionary sense", () =>
    Effect.gen(function* () {
      yield* Dictionary.insertEntries([entry(1358280, "食べる", "たべる", [sense(["to eat"]), sense(["to live on"])])])
      const user = yield* learner("notes@example.com")
      const note = yield* Study.addNote(user, { content: word(0) })
      assert.deepStrictEqual(
        note.cards.map((card) => [card.template, card.queue]),
        [
          ["recognize", "new"],
          ["produce", "new"]
        ]
      )
      assert.strictEqual((yield* Study.addNote(user, { content: word(0) })).id, note.id)
      yield* TestClock.adjust("1 minute")
      const recognizeOnly = yield* Study.addNote(user, { content: phrase, templates: ["recognize"] })
      assert.strictEqual(recognizeOnly.cards.length, 1)

      assert.deepStrictEqual(
        (yield* Study.notes(user)).map((n) => n.content.kind),
        ["phrase", "word"]
      )
      assert.isTrue(yield* Study.removeNote(user, note.id))
      assert.isFalse(yield* Study.removeNote(user, note.id))
      assert.strictEqual((yield* Study.notes(user)).length, 1)
    })
  )

  it.effect("serves new cards in the order they were saved, then schedules reviews by the answers", () =>
    Effect.gen(function* () {
      const user: Profile = { ...(yield* learner("review@example.com")), timezone: "Asia/Tokyo" }
      const first = yield* Study.addNote(user, { content: word(0), templates: ["recognize"] })
      yield* Study.addNote(user, { content: word(1), templates: ["recognize"] })

      const queue = yield* Study.queue(user, 10)
      assert.deepStrictEqual(queue.counts, { new: 2, learning: 0, review: 0 })
      assert.strictEqual(queue.items[0]?.card.noteId, first.id)
      assert.strictEqual(queue.items[0]?.labels.again, "1m")

      const answered = Option.getOrThrow(yield* Study.answer(user, queue.items[0]!.card.id, "easy", 4200))
      assert.strictEqual(answered.card.queue, "review")
      assert.isAtLeast(answered.card.interval, 3)
      assert.isTrue(Option.isNone(yield* Study.answer(user, CardId.make(crypto.randomUUID()), "good", undefined)))

      const today = yield* Study.stats(user)
      assert.strictEqual(today.reviewedToday, 1)
      assert.strictEqual(today.streak, 1)
      assert.deepStrictEqual([today.cards, today.unseen, today.young, today.mature], [2, 1, 1, 0])
      assert.strictEqual(
        today.forecast.reduce((sum, n) => sum + n, 0),
        1
      )

      // Once the interval has passed, the card comes back as a review.
      yield* TestClock.adjust(answered.card.interval * DAY)
      const later = yield* Study.queue(user, 10)
      assert.deepStrictEqual(later.counts, { new: 1, learning: 0, review: 1 })
      yield* Study.answer(user, answered.card.id, "again", undefined)
      const after = yield* Study.stats(user)
      assert.strictEqual(after.retention, 0)
      assert.strictEqual(after.due.learning, 1)
    })
  )
})
