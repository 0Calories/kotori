import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "vitest"
import { brand, SITE_URL } from "../src/i18n/brand.ts"
import { strings } from "../src/i18n/strings.ts"
import { webLanguageFromLocation } from "../src/lib/webLanguage.ts"
import { applyWebMeta } from "../src/lib/webMeta.ts"

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..")

const collectStrings = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (typeof value === "function") return []
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(collectStrings)
  return []
}

describe("branding copy and localized metadata", () => {
  it("uses the updated companion positioning in English and Japanese", () => {
    assert.strictEqual(strings.en.onboarding.subtitle, brand.en.tagline)
    assert.strictEqual(strings.ja.onboarding.subtitle, brand.ja.tagline)
    assert.notInclude(strings.en.onboarding.subtitle.toLowerCase(), "textbook")
    assert.notInclude(strings.ja.onboarding.subtitle, "教科書")
  })

  it("standardizes Japanese app copy on hiragana ことり without katakana コトリ", () => {
    const jaTexts = collectStrings(strings.ja)
    assert.isAbove(jaTexts.length, 0)
    for (const text of jaTexts) {
      assert.notInclude(text, "コトリ")
    }
    assert.strictEqual(strings.ja.appName, "ことり")
    assert.strictEqual(strings.ja.dictionary.askKotori, "ことりに聞く")
    assert.strictEqual(strings.ja.entry.sourceName.kotori, "ことり")
    assert.notInclude(strings.ja.auth.errors.googleAlreadyLinked, "Kotori")
  })

  it("detects explicit web language from /ja or ?lang= query params", () => {
    assert.strictEqual(webLanguageFromLocation("/ja", ""), "ja")
    assert.strictEqual(webLanguageFromLocation("/ja/", ""), "ja")
    assert.strictEqual(webLanguageFromLocation("/", "?lang=ja"), "ja")
    assert.strictEqual(webLanguageFromLocation("/welcome", "?lang=en"), "en")
    assert.strictEqual(webLanguageFromLocation("/", ""), null)
    assert.strictEqual(webLanguageFromLocation("/japanese", ""), null)
    assert.strictEqual(webLanguageFromLocation("/", "?lang=fr"), null)
  })

  it("renders distinct English and Japanese Open Graph and X card HTML", () => {
    const shell = readFileSync(join(appDir, "public", "index.html"), "utf8").replace(
      "</body>",
      '<script src="/_expo/static/js/web/index.js" defer></script></body>'
    )

    const enHtml = applyWebMeta(shell, "en")
    assert.include(enHtml, '<html lang="en">')
    assert.include(enHtml, "<title>Kotori — Real-world Japanese &amp; English</title>")
    assert.include(enHtml, `property="og:image" content="${SITE_URL}/og-image.png"`)
    assert.include(enHtml, `name="twitter:image" content="${SITE_URL}/og-image.png"`)
    assert.include(enHtml, 'property="og:locale" content="en_US"')
    assert.notMatch(enHtml, /rel="canonical"/)
    assert.notMatch(enHtml, /property="og:url"/)
    assert.include(enHtml, `rel="alternate" hreflang="ja" href="${SITE_URL}/ja"`)
    assert.strictEqual(enHtml.match(/name="description"/g)?.length, 1)
    assert.include(enHtml, '<script src="/_expo/static/js/web/index.js" defer></script>')

    const jaHtml = applyWebMeta(shell, "ja")
    assert.include(jaHtml, '<html lang="ja">')
    assert.include(jaHtml, `<title>${brand.ja.title}</title>`)
    assert.include(jaHtml, `property="og:site_name" content="${brand.ja.appName}"`)
    assert.include(jaHtml, `property="og:image" content="${SITE_URL}/og-image-ja.png"`)
    assert.include(jaHtml, `name="twitter:image" content="${SITE_URL}/og-image-ja.png"`)
    assert.include(jaHtml, 'property="og:locale" content="ja_JP"')
    assert.include(jaHtml, `rel="canonical" href="${SITE_URL}/ja"`)
    assert.include(jaHtml, `property="og:url" content="${SITE_URL}/ja"`)
    assert.include(jaHtml, 'name="twitter:card" content="summary_large_image"')
    assert.include(jaHtml, brand.ja.noscriptBody)
    assert.strictEqual(jaHtml.match(/name="description"/g)?.length, 1)
    assert.include(jaHtml, '<script src="/_expo/static/js/web/index.js" defer></script>')
  })

  it("ships both EN and JP OG thumbnails", () => {
    assert.isTrue(existsSync(join(appDir, "public", "og-image.png")))
    assert.isTrue(existsSync(join(appDir, "public", "og-image-ja.png")))
  })
})
