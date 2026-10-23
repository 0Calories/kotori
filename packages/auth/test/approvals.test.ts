import { assert, layer } from "@effect/vitest"
import { Repositories, UsersRepo } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Mailbox, MailerMemory } from "@kotori/email"
import { Effect, Layer, Option } from "effect"
import { Headers } from "effect/http"
import { Approvals } from "../src/Approvals.ts"
import { Auth, TestAuth } from "../src/Auth.ts"

const TestLayer = Approvals.layer.pipe(
  Layer.provideMerge(Auth.layerMemory),
  Layer.provideMerge(Layer.mergeAll(TestAuth.layer, MailerMemory, Repositories)),
  Layer.provideMerge(DatabaseMemory)
)

const signUp = (email: string, name: string) => Effect.flatMap(TestAuth, (auth) => auth.signUp(email, name))

layer(TestLayer)("Approvals", (it) => {
  it.effect("lists requests, approves with an email, archives silently", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals
      const mailbox = yield* Mailbox
      const users = yield* UsersRepo

      yield* signUp("first@example.com", "First")
      const second = yield* signUp("second@example.com", "二番目")
      // Sign-up emails are Managed Auth's business (via webhooks); nothing is sent from here.
      assert.deepStrictEqual(yield* mailbox.messages, [])

      // Learners who haven't opened the app yet still show up as pending.
      const pending = yield* approvals.requests()
      assert.deepStrictEqual(
        pending.map((u) => [u.email, u.status]),
        [
          ["first@example.com", "pending"],
          ["second@example.com", "pending"]
        ]
      )

      const archived = yield* approvals.archive("first@example.com")
      assert.strictEqual(archived.status, "archived")
      assert.deepStrictEqual(
        (yield* approvals.requests()).map((u) => u.email),
        ["second@example.com"]
      )
      assert.deepStrictEqual(
        (yield* approvals.requests({ all: true })).map((u) => u.email),
        ["first@example.com", "second@example.com"]
      )
      assert.deepStrictEqual(yield* mailbox.messages, [])

      // A learner who already opened the app and picked Japanese is welcomed in Japanese.
      yield* users.ensure({
        id: second.id,
        status: "pending",
        role: "user",
        nativeLanguage: "ja",
        targetLanguage: "en",
        onboardedAt: 1,
        displayName: null,
        timezone: "Asia/Tokyo",
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        createdAt: 1
      })
      const approved = yield* approvals.approve("Second@Example.com")
      assert.strictEqual(approved.status, "approved")
      const sent = yield* mailbox.messages
      assert.strictEqual(sent.length, 1)
      assert.strictEqual(sent[0]?.to, "second@example.com")
      assert.include(sent[0]?.subject, "ようこそ")

      // Approving again is a no-op.
      yield* approvals.approve("second@example.com")
      assert.strictEqual((yield* mailbox.messages).length, 1)

      // Archived accounts can still be approved later, in English by default.
      yield* approvals.approve("first@example.com")
      assert.strictEqual((yield* approvals.requests({ all: true })).length, 0)
      assert.include((yield* mailbox.messages)[1]?.subject, "Welcome")

      const missing = yield* approvals.approve("nobody@example.com").pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NoSuchUser")
    })
  )

  it.effect("promotes admins and revokes sessions", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals
      const auth = yield* Auth
      const users = yield* UsersRepo

      const user = yield* signUp("admin@example.com", "Admin")
      const promoted = yield* approvals.setRole("admin@example.com", "admin")
      assert.strictEqual(promoted.role, "admin")
      // The role lives on Kotori's profile, created on the spot if needed.
      assert.strictEqual(Option.getOrThrow(yield* users.byId(user.id)).role, "admin")

      const before = yield* auth.sessionFromCookies(Headers.fromInput({ cookie: user.cookie }))
      assert.isTrue(Option.isSome(before))

      yield* approvals.revoke("admin@example.com")
      const after = yield* auth.sessionFromCookies(Headers.fromInput({ cookie: user.cookie }))
      assert.isTrue(Option.isNone(after))
    })
  )
})
