import { assert, describe, it } from "@effect/vitest"
import { templates } from "../src/templates.ts"

describe("email templates", () => {
  it("writes in the learner's language", () => {
    const en = templates.approved({ to: "a@example.com", name: "Learner", language: "en" })
    assert.include(en.subject, "Welcome")
    assert.include(en.text, "Hi Learner,")
    assert.include(en.html, "<p>Hi Learner,</p>")

    const ja = templates.approved({ to: "a@example.com", name: null, language: "ja" })
    assert.include(ja.subject, "ようこそ")
    assert.include(ja.text, "こんにちは。")
  })

  it("escapes html in names", () => {
    const email = templates.approved({ to: "a@example.com", name: "<b>", language: "en" })
    assert.notInclude(email.html, "<b>")
    assert.include(email.html, "&lt;b&gt;")
    assert.include(email.text, "Hi <b>,")
  })
})
