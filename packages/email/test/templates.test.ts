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

  it("puts a code in text and html, or a clickable link", () => {
    const code = templates.verifyEmail({ to: "a@example.com", name: "Learner", language: "en" }, { code: "123456" })
    assert.include(code.subject, "confirm")
    assert.include(code.text, "Enter this code in the app")
    assert.include(code.text, "\n123456\n")
    assert.include(code.html, ">123456</p>")
    assert.notInclude(code.html, "href")

    const link = templates.resetPassword(
      { to: "a@example.com", name: null, language: "ja" },
      { url: "https://kotori.app/reset?token=abc" }
    )
    assert.include(link.subject, "パスワード")
    assert.include(link.text, "https://kotori.app/reset?token=abc")
    assert.include(link.html, 'href="https://kotori.app/reset?token=abc"')
    assert.include(link.text, "心当たりがなければ")
  })

  it("escapes html in names and links", () => {
    const email = templates.approved({ to: "a@example.com", name: "<b>", language: "en" })
    assert.notInclude(email.html, "<b>")
    assert.include(email.html, "&lt;b&gt;")
    assert.include(email.text, "Hi <b>,")

    const link = templates.signIn(
      { to: "a@example.com", name: null, language: "en" },
      { url: "https://x.test/?a=1&b=2" }
    )
    assert.include(link.html, "a=1&amp;b=2")
    assert.include(link.text, "a=1&b=2")
  })
})
