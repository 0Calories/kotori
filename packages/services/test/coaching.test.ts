import { assert, layer } from "@effect/vitest"
import { Coach, ExampleWriter } from "@kotori/ai"
import { DatabaseMemory } from "@kotori/db/testing"
import { EntryId, type Profile } from "@kotori/domain"
import { MailerMemory } from "@kotori/email"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Accounts, Coaching, Dictionary, makeServices } from "../src/index.ts"
import { AuthMemory, TestAuth } from "../src/testing.ts"
import { entry, FakeClaude, FakeElevenLabs, FakeJev, sense } from "./fixtures.ts"

/** How many answers the coach was paid for. */
let asked = 0

const FakeCoach = Layer.succeed(
  Coach,
  Coach.of({
    naturalness: (request) =>
      Effect.sync(() => {
        asked++
        return {
          verdict: "natural",
          score: 90,
          summary: "Sounds right.",
          meaning: request.text,
          register: "polite",
          issues: [],
          rewrites: []
        }
      }),
    howToSay: () =>
      Effect.sync(() => {
        asked++
        return {
          intent: "to eat",
          phrases: [],
          keyWords: [
            { word: "食べる", reading: "たべる", meaning: "to eat", note: "" },
            { word: "未知語", reading: "みちご", meaning: "unknown", note: "" }
          ],
          pitfalls: [],
          culturalNote: null
        }
      })
  })
)

const TestLayer = makeServices(
  Layer.mergeAll(
    FakeCoach,
    ExampleWriter.layer.pipe(Layer.provideMerge(FakeClaude)),
    FakeJev,
    FakeElevenLabs,
    MailerMemory,
    AuthMemory
  ).pipe(Layer.provideMerge(TestAuth.layer)),
  DatabaseMemory
).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ KOTORI_COACH_HOURLY_LIMIT: "2" }))))

const learner = (email: string) =>
  Effect.gen(function* () {
    const auth = yield* TestAuth
    const { cookie } = yield* auth.signUp(email, "Learner")
    return yield* Accounts.profile(Option.getOrThrow(yield* auth.userForCookie(cookie)))
  })

layer(TestLayer)("Coaching", (it) => {
  it.effect("answers the same question once, and counts only fresh answers toward the hourly limit", () =>
    Effect.gen(function* () {
      const user: Profile = yield* learner("cached@example.com")
      const first = yield* Coaching.naturalness(user, { text: "私は学生です。" })
      assert.strictEqual(first.verdict, "natural")
      // Jev reads the formality alongside.
      assert.isNotNull(first.formality)
      assert.deepStrictEqual(yield* Coaching.naturalness(user, { text: "私は学生です。" }), first)
      assert.strictEqual(asked, 1)

      yield* Coaching.naturalness(user, { text: "猫が好きです。" })
      const limited = yield* Coaching.naturalness(user, { text: "犬が好きです。" }).pipe(Effect.flip)
      assert.strictEqual(limited._tag, "RateLimited")
      assert.strictEqual(asked, 2)

      // Cached answers are still served, and the limit is per hour.
      assert.strictEqual((yield* Coaching.naturalness(user, { text: "私は学生です。" })).score, 90)
      yield* TestClock.adjust("61 minutes")
      yield* Coaching.naturalness(user, { text: "犬が好きです。" })
      assert.strictEqual(asked, 3)
    })
  )

  it.effect("links the key words of a how-to-say answer to the dictionary", () =>
    Effect.gen(function* () {
      yield* Dictionary.insertEntries([entry(1358280, "食べる", "たべる", [sense(["to eat"])])])
      const user = yield* learner("words@example.com")
      const answer = yield* Coaching.howToSay(user, { text: "to eat" })
      assert.deepStrictEqual(
        answer.keyWords.map((word) => word.entryId),
        [EntryId.make(1358280), null]
      )
    })
  )

  it.effect("speaks sentences and links to the clip", () =>
    Effect.gen(function* () {
      const user = yield* learner("speak@example.com")
      const { url } = yield* Coaching.speak(user, { text: "いただきます", language: "ja" })
      assert.match(url, /^\/audio\/[a-f0-9]{64}\.mp3$/)
    })
  )
})
