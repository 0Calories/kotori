import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Repositories, UsersRepo } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Mailbox, MailerMemory } from "@kotori/email"
import { Effect, Layer } from "effect"
import { Approvals } from "../src/Approvals.ts"
import { Auth } from "../src/Auth.ts"

const TestLayer = Approvals.layer.pipe(
  Layer.provideMerge(Auth.layerTest),
  Layer.provideMerge(Layer.mergeAll(MailerMemory, Repositories)),
  Layer.provideMerge(DatabaseMemory),
  Layer.provideMerge(NodeServices.layer)
)

const PASSWORD = "correct-horse-battery-staple"

const signUp = (email: string, name: string, locale: "en" | "ja" = "en") =>
  Effect.gen(function* () {
    const auth = yield* Auth
    const result = yield* Effect.promise(() =>
      auth.api.signUpEmail({ body: { email, password: PASSWORD, name, locale }, returnHeaders: true })
    )
    return { id: result.response.user.id, cookie: (result.headers.get("set-cookie") ?? "").split(";")[0]! }
  })

layer(TestLayer)("Approvals", (it) => {
  it.effect("lists requests, approves with an email, archives silently", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals
      const mailbox = yield* Mailbox

      yield* signUp("first@example.com", "First")
      yield* signUp("second@example.com", "二番目", "ja")
      // Sign-up itself sends verification emails.
      assert.deepStrictEqual(
        (yield* mailbox.messages).map((m) => m.to),
        ["first@example.com", "second@example.com"]
      )
      yield* mailbox.clear

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

      // Approval emails the learner in their sign-up language until they pick one.
      const approved = yield* approvals.approve("Second@Example.com")
      assert.strictEqual(approved.status, "approved")
      const sent = yield* mailbox.messages
      assert.strictEqual(sent.length, 1)
      assert.strictEqual(sent[0]?.to, "second@example.com")
      assert.include(sent[0]?.subject, "ようこそ")

      // Approving again is a no-op.
      yield* approvals.approve("second@example.com")
      assert.strictEqual((yield* mailbox.messages).length, 1)

      // Archived accounts can still be approved later.
      yield* approvals.approve("first@example.com")
      assert.strictEqual((yield* approvals.requests({ all: true })).length, 0)

      const missing = yield* approvals.approve("nobody@example.com").pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NoSuchUser")
    })
  )

  it.effect("promotes admins and revokes sessions", () =>
    Effect.gen(function* () {
      const approvals = yield* Approvals
      const auth = yield* Auth
      const users = yield* UsersRepo

      const user = yield* signUp("admin@example.com", "Ash")
      const promoted = yield* approvals.setRole("admin@example.com", "admin")
      assert.strictEqual(promoted.role, "admin")

      const before = yield* Effect.promise(() => auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) }))
      assert.isNotNull(before)

      yield* approvals.revoke("admin@example.com")
      const after = yield* Effect.promise(() => auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) }))
      assert.isNull(after)

      // No profile row is created by admin actions alone; the API does that on first request.
      assert.isTrue((yield* users.byId(user.id))._tag === "None")
    })
  )
})
