import { assert, describe, it } from "@effect/vitest"
import { templates } from "../src/templates.ts"

describe("email templates", () => {
  it("writes in the learner's language and includes the link in text and html", () => {
    const en = templates.verifyEmail(
      { to: "a@example.com", name: "Ash", language: "en" },
      "https://kotori.app/verify?token=abc"
    )
    assert.include(en.subject, "confirm")
    assert.include(en.text, "Hi Ash,")
    assert.include(en.text, "https://kotori.app/verify?token=abc")
    assert.include(en.html, 'href="https://kotori.app/verify?token=abc"')

    const ja = templates.approved({ to: "a@example.com", name: null, language: "ja" })
    assert.include(ja.subject, "ようこそ")
    assert.include(ja.text, "こんにちは。")
  })

  it("escapes html in names and links", () => {
    const email = templates.resetPassword(
      { to: "a@example.com", name: "<b>", language: "en" },
      "https://x.test/?a=1&b=2"
    )
    assert.notInclude(email.html, "<b>")
    assert.include(email.html, "&lt;b&gt;")
    assert.include(email.html, "a=1&amp;b=2")
    assert.include(email.text, "a=1&b=2")
  })
})
