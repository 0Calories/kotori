import { assert, layer } from "@effect/vitest"
import { at, Database } from "@kotori/db"
import { coachUsage } from "@kotori/db/schema"
import { Mailbox } from "@kotori/email"
import { Effect, Option } from "effect"
import { Headers } from "effect/http"
import { identityByEmail } from "../src/accounts/identity.ts"
import { Accounts } from "../src/index.ts"
import { TestAuth } from "../src/testing.ts"
import { servicesWith } from "./fixtures.ts"

const signUp = (email: string, name: string) => Effect.flatMap(TestAuth, (auth) => auth.signUp(email, name))

/** The signed-in user behind a session cookie, as the API resolves it. */
const signedIn = (cookie: string) => Accounts.authenticate({ cookies: Headers.fromInput({ cookie }) })

/** The learner opens the app: their profile appears, pending. */
const opens = (cookie: string) => Effect.flatMap(signedIn(cookie), (user) => Accounts.profile(Option.getOrThrow(user)))

layer(servicesWith())("Accounts approvals", (it) => {
  it.effect("lists requests, approves with an email, archives silently", () =>
    Effect.gen(function* () {
      const mailbox = yield* Mailbox
      yield* signUp("first@example.com", "First")
      const second = yield* signUp("second@example.com", "二番目")
      // Sign-up emails are Managed Auth's business (via webhooks); nothing is sent from here.
      assert.deepStrictEqual(yield* mailbox.messages, [])

      // Learners who haven't opened the app yet still show up as pending.
      assert.deepStrictEqual(
        (yield* Accounts.requests()).map((u) => [u.email, u.status]),
        [
          ["first@example.com", "pending"],
          ["second@example.com", "pending"]
        ]
      )

      const archived = yield* Accounts.archive("first@example.com")
      assert.strictEqual(archived.status, "archived")
      assert.deepStrictEqual(
        (yield* Accounts.requests()).map((u) => u.email),
        ["second@example.com"]
      )
      assert.deepStrictEqual(
        (yield* Accounts.requests({ all: true })).map((u) => u.email),
        ["first@example.com", "second@example.com"]
      )
      assert.deepStrictEqual(yield* mailbox.messages, [])

      // A learner who already opened the app and picked Japanese is welcomed in Japanese.
      yield* Accounts.update(yield* opens(second.cookie), { nativeLanguage: "ja" })
      const approved = yield* Accounts.approve("Second@Example.com")
      assert.strictEqual(approved.status, "approved")
      const sent = yield* mailbox.messages
      assert.strictEqual(sent.length, 1)
      assert.strictEqual(sent[0]?.to, "second@example.com")
      assert.include(sent[0]?.subject, "ようこそ")
      assert.strictEqual((yield* opens(second.cookie)).status, "approved")

      // Approving again is a no-op.
      yield* Accounts.approve("second@example.com")
      assert.strictEqual((yield* mailbox.messages).length, 1)

      // Archived accounts can still be approved later, in English by default.
      yield* Accounts.approve("first@example.com")
      assert.strictEqual((yield* Accounts.requests({ all: true })).length, 0)
      assert.include((yield* mailbox.messages)[1]?.subject, "Welcome")

      const missing = yield* Accounts.approve("nobody@example.com").pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NoSuchUser")
    })
  )

  it.effect("promotes admins and revokes sessions", () =>
    Effect.gen(function* () {
      const user = yield* signUp("admin@example.com", "Admin")
      const promoted = yield* Accounts.setRole("admin@example.com", "admin")
      assert.strictEqual(promoted.role, "admin")
      // The role lives on Kotori's profile, created on the spot if needed.
      assert.strictEqual((yield* opens(user.cookie)).role, "admin")

      yield* Accounts.revoke("admin@example.com")
      assert.isTrue(Option.isNone(yield* signedIn(user.cookie)))
      assert.deepStrictEqual(
        (yield* Accounts.accounts).map((a) => [a.email, a.role]),
        [
          ["first@example.com", "user"],
          ["second@example.com", "user"],
          ["admin@example.com", "admin"]
        ]
      )
    })
  )
})

layer(servicesWith())("Accounts profiles", (it) => {
  it.effect("creates a profile once, updates it, and deletes it with everything the learner did", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const user = yield* signUp("learner@example.com", " Learner ")
      const created = yield* opens(user.cookie)
      assert.deepStrictEqual(
        [created.status, created.role, created.nativeLanguage, created.onboarded, created.displayName],
        ["pending", "user", "en", false, "Learner"]
      )

      const updated = yield* Accounts.update(created, {
        nativeLanguage: "ja",
        displayName: "  ",
        timezone: "Asia/Tokyo",
        dailyNewLimit: 10
      })
      assert.deepStrictEqual(
        [updated.nativeLanguage, updated.targetLanguage, updated.onboarded, updated.displayName, updated.timezone],
        ["ja", "en", true, null, "Asia/Tokyo"]
      )
      // A time zone that doesn't exist is ignored; an empty request changes nothing.
      assert.strictEqual((yield* Accounts.update(updated, { timezone: "Not/AZone" })).timezone, "Asia/Tokyo")
      assert.deepStrictEqual(yield* Accounts.update(updated, {}), updated)
      // Seeing the learner again keeps what they chose.
      assert.strictEqual((yield* opens(user.cookie)).dailyNewLimit, 10)

      yield* db.insert(coachUsage).values({ userId: updated.id, kind: "naturalness", createdAt: at(0) })
      yield* Accounts.remove(updated.id)
      assert.strictEqual(yield* db.$count(coachUsage), 0)
      assert.isTrue(Option.isNone(yield* identityByEmail("learner@example.com")))
      assert.isTrue(Option.isNone(yield* signedIn(user.cookie)))
    })
  )

  it.effect("creates the development account, and repairs it on a second run", () =>
    Effect.gen(function* () {
      const options = { email: "dev@kotori.test", password: "pw", nativeLanguage: "en" as const, admin: false }
      const first = yield* Accounts.ensureDevAccount(options)
      assert.isTrue(first.created)
      const account = (yield* Accounts.accounts).find((a) => a.email === "dev@kotori.test")
      assert.deepStrictEqual([account?.status, account?.role, account?.emailVerified], ["approved", "user", true])

      yield* Accounts.archive("dev@kotori.test")
      const second = yield* Accounts.ensureDevAccount({ ...options, nativeLanguage: "ja", admin: true })
      assert.isFalse(second.created)
      const repaired = (yield* Accounts.accounts).find((a) => a.email === "dev@kotori.test")
      assert.deepStrictEqual([repaired?.status, repaired?.role], ["approved", "admin"])
    })
  )
})

/** A Managed Auth webhook as Neon sends it, signed by the fake. */
const webhook = (
  type: string,
  data: object,
  user: { id: string; email: string; name: string },
  id = crypto.randomUUID()
) =>
  Effect.gen(function* () {
    const body = JSON.stringify({
      event_id: id,
      event_type: type,
      timestamp: new Date().toISOString(),
      user: { ...user, email_verified: false },
      event_data: data
    })
    const headers = yield* (yield* TestAuth).signWebhook(body)
    return yield* Accounts.deliverAuthEmail(Headers.fromInput(headers), new TextEncoder().encode(body))
  })

layer(servicesWith())("Accounts.deliverAuthEmail", (it) => {
  it.effect("emails the code, in English until the learner has picked a language", () =>
    Effect.gen(function* () {
      const mailbox = yield* Mailbox
      const user = yield* signUp("new@example.com", "New")
      const who = { id: user.id, email: "new@example.com", name: "New" }
      const code = { otp_code: "482913", otp_type: "email-verification" }
      assert.strictEqual(yield* webhook("send.otp", code, who), "sent")
      const [english] = yield* mailbox.messages
      assert.strictEqual(english?.to, "new@example.com")
      assert.include(english?.subject, "confirm your email")
      assert.include(english?.text, "Hi New,")
      assert.include(english?.text, "482913")

      yield* Accounts.update(yield* opens(user.cookie), { nativeLanguage: "ja" })
      yield* mailbox.clear
      const link = { link_type: "forget-password", link_url: "https://auth.test/reset-password/tok" }
      assert.strictEqual(yield* webhook("send.magic_link", link, who), "sent")
      const [japanese] = yield* mailbox.messages
      assert.include(japanese?.subject, "パスワードの再設定")
      assert.include(japanese?.text, "https://auth.test/reset-password/tok")
    })
  )

  it.effect("acknowledges other events and doesn't send one event twice", () =>
    Effect.gen(function* () {
      const mailbox = yield* Mailbox
      yield* mailbox.clear
      const who = { id: crypto.randomUUID(), email: "retry@example.com", name: "" }
      assert.strictEqual(yield* webhook("user.created", { auth_provider: "credential" }, who), "ignored")

      // Neon retries with the same event id when it didn't see the first answer.
      const code = { otp_code: "1", otp_type: "sign-in" }
      const id = crypto.randomUUID()
      assert.strictEqual(yield* webhook("send.otp", code, who, id), "sent")
      assert.strictEqual(yield* webhook("send.otp", code, who, id), "duplicate")
      assert.strictEqual((yield* mailbox.messages).length, 1)
    })
  )
})
