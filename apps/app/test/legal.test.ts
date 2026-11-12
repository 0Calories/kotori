import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "vitest"
import { isUnguardedRoute, legalDocument, legalLanguageFromParam } from "../src/lib/legal.ts"

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("public legal pages (/privacy and /terms)", () => {
  it("keeps /privacy and /terms unguarded and reachable without signing in", () => {
    assert.isTrue(isUnguardedRoute("/privacy"))
    assert.isTrue(isUnguardedRoute("/privacy/"))
    assert.isTrue(isUnguardedRoute("/terms"))
    assert.isTrue(isUnguardedRoute("/terms/"))

    assert.isFalse(isUnguardedRoute("/"))
    assert.isFalse(isUnguardedRoute("/welcome"))
    assert.isFalse(isUnguardedRoute("/settings"))
    assert.isFalse(isUnguardedRoute("/privacy-policy"))
    assert.isFalse(isUnguardedRoute("/terms-of-service"))

    const layout = readFileSync(join(appDir, "app/_layout.tsx"), "utf8")
    const beforeProtected = layout.split("<Stack.Protected")[0] ?? ""
    assert.match(beforeProtected, /Stack\.Screen name="privacy"/)
    assert.match(beforeProtected, /Stack\.Screen name="terms"/)

    for (const page of ["app/welcome.tsx", "app/sign-up.tsx", "app/settings.tsx"]) {
      assert.match(readFileSync(join(appDir, page), "utf8"), /<LegalLinks\s*\/>/)
    }
  })

  it("picks an explicit ?lang=en|ja override or falls back to the active language", () => {
    assert.strictEqual(legalLanguageFromParam("ja", "en"), "ja")
    assert.strictEqual(legalLanguageFromParam(["en"], "ja"), "en")
    assert.strictEqual(legalLanguageFromParam(undefined, "ja"), "ja")
    assert.strictEqual(legalLanguageFromParam("fr", "en"), "en")
  })

  it("provides distinct, complete English and Japanese privacy and terms documents", () => {
    for (const kind of ["privacy", "terms"] as const) {
      const en = legalDocument(kind, "en")
      const ja = legalDocument(kind, "ja")
      assert.notStrictEqual(en.title, ja.title)
      assert.notStrictEqual(en.intro, ja.intro)
      assert.strictEqual(en.companionHref, ja.companionHref)
      assert.deepStrictEqual(
        en.sections.map((s) => s.id),
        ja.sections.map((s) => s.id)
      )
      for (let i = 0; i < en.sections.length; i++) {
        const enSection = en.sections[i]!
        const jaSection = ja.sections[i]!
        assert.isAbove(enSection.paragraphs.length, 0)
        assert.strictEqual(enSection.paragraphs.length, jaSection.paragraphs.length)
        assert.notStrictEqual(enSection.title, jaSection.title)
        assert.notStrictEqual(enSection.paragraphs[0], jaSection.paragraphs[0])
      }
    }

    const privacyText = legalDocument("privacy", "en")
      .sections.flatMap((s) => s.paragraphs)
      .join(" ")
    assert.include(privacyText, "Google")
    assert.include(privacyText, "Delete account")

    const termsText = legalDocument("terms", "en")
      .sections.flatMap((s) => s.paragraphs)
      .join(" ")
    assert.include(termsText, "JMDict")
    assert.include(termsText, "CC BY-SA 4.0")
  })
})
