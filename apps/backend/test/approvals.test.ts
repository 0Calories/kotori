import { assert, layer } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { Headers } from "effect/http"
import { Database } from "../src/db/Database.ts"
import { Approvals } from "../src/features/accounts/Approvals.ts"
import { ensureUser, userById } from "../src/features/accounts/queries.ts"
import { Auth, TestAuth } from "../src/integrations/auth/Auth.ts"
import { Mailbox, MailError, Mailer, MailerMemory } from "../src/integrations/email/Mailer.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

const approvalsLayer = <A, E>(mailer: Layer.Layer<Mailer | A, E>) =>
  Approvals.layer.pipe(
    Layer.provideMerge(Auth.layerMemory),
    Layer.provideMerge(Layer.mergeAll(TestAuth.layer, mailer)),
    Layer.provideMerge(DatabaseMemory)
  )

const TestLayer = approvalsLayer(MailerMemory)

const signUp = (email: string, name: string) => Effect.flatMap(TestAuth, (auth) => auth.signUp(email, name))

layer(TestLayer)("Approvals", (it) => {
  it.effect("lists requests, approves with an email, archives silently", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals
      const mailbox = yield* Mailbox
      const db = yield* Database

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
      yield* ensureUser(db, {
        id: second.id,
        status: "pending",
        role: "user",
        nativeLanguage: "ja",
        targetLanguage: "en",
        onboardedAt: new Date(1),
        displayName: null,
        timezone: "Asia/Tokyo",
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        createdAt: new Date(1)
      })
      const approved = yield* approvals.approve("Second@Example.com")
      assert.strictEqual(approved.account.status, "approved")
      assert.strictEqual(approved.alreadyApproved, false)
      assert.strictEqual(approved.emailStatus, "sent")
      const sent = yield* mailbox.messages
      assert.strictEqual(sent.length, 1)
      assert.strictEqual(sent[0]?.to, "second@example.com")
      assert.include(sent[0]?.subject, "ようこそ")

      // Approving again is a no-op unless `--resend` is requested.
      const repeated = yield* approvals.approve("second@example.com")
      assert.strictEqual(repeated.alreadyApproved, true)
      assert.strictEqual(repeated.emailStatus, "skipped")
      assert.strictEqual((yield* mailbox.messages).length, 1)

      const resent = yield* approvals.approve("second@example.com", { resend: true })
      assert.strictEqual(resent.alreadyApproved, true)
      assert.strictEqual(resent.emailStatus, "sent")
      assert.strictEqual((yield* mailbox.messages).length, 2)

      // Archived accounts can still be approved later, in English by default.
      const fromArchived = yield* approvals.approve("first@example.com")
      assert.strictEqual(fromArchived.alreadyApproved, false)
      assert.strictEqual(fromArchived.emailStatus, "sent")
      assert.strictEqual((yield* approvals.requests({ all: true })).length, 0)
      assert.include((yield* mailbox.messages)[2]?.subject, "Welcome")

      const missing = yield* approvals.approve("nobody@example.com").pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NoSuchUser")
    })
  )

  it.effect("promotes admins and revokes sessions", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const approvals = yield* Approvals
      const auth = yield* Auth

      const user = yield* signUp("admin@example.com", "Admin")
      const promoted = yield* approvals.setRole("admin@example.com", "admin")
      assert.strictEqual(promoted.role, "admin")
      // The role lives on Kotori's profile, created on the spot if needed.
      assert.strictEqual(Option.getOrThrow(yield* userById(db, user.id)).role, "admin")

      const before = yield* auth.sessionFromCookies(Headers.fromInput({ cookie: user.cookie }))
      assert.isTrue(Option.isSome(before))

      yield* approvals.revoke("admin@example.com")
      const after = yield* auth.sessionFromCookies(Headers.fromInput({ cookie: user.cookie }))
      assert.isTrue(Option.isNone(after))
    })
  )
})

const FailingMailer = Layer.succeed(
  Mailer,
  Mailer.of({
    configured: true,
    send: () => Effect.fail(new MailError({ message: "Resend returned 403" }))
  })
)

layer(approvalsLayer(FailingMailer))("Approvals with failing mailer", (it) => {
  it.effect("still approves the account and reports email failure", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals
      const db = yield* Database

      const user = yield* signUp("blocked@example.com", "Blocked")
      const result = yield* approvals.approve("blocked@example.com")
      assert.strictEqual(result.account.status, "approved")
      assert.strictEqual(result.alreadyApproved, false)
      assert.strictEqual(result.emailStatus, "failed")
      assert.strictEqual(Option.getOrThrow(yield* userById(db, user.id)).status, "approved")
    })
  )
})

layer(approvalsLayer(Mailer.layerConsole))("Approvals with console mailer", (it) => {
  it.effect("reports email as logged when mailer is not configured", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals

      yield* signUp("dev@example.com", "Dev")
      const result = yield* approvals.approve("dev@example.com")
      assert.strictEqual(result.account.status, "approved")
      assert.strictEqual(result.alreadyApproved, false)
      assert.strictEqual(result.emailStatus, "logged")
    })
  )
})
