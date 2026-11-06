import { assert, describe, it } from "@effect/vitest"
import { webOriginAllowed } from "../src/http/cors.ts"

describe("web origins", () => {
  it("allows the configured web app, wildcard preview subdomains, and local dev servers only outside production", () => {
    const production = webOriginAllowed(["https://app.kotori.app", "https://kotori-*.vercel.app"], true)
    assert.isTrue(production("https://app.kotori.app"))
    assert.isTrue(production("https://kotori-git-feat-preview-ash.vercel.app"))
    assert.isTrue(production("https://kotori-9f8a7b6c.vercel.app"))
    assert.isFalse(production("https://kotori-.vercel.app"))
    assert.isFalse(production("https://kotori-sub.sub.vercel.app"))
    assert.isFalse(production("https://kotori-abc.vercel.app.evil.example"))
    assert.isFalse(production("http://kotori-abc.vercel.app"))
    assert.isFalse(production("https://evil.example"))
    assert.isFalse(production("http://localhost:8081"))

    const development = webOriginAllowed([], false)
    assert.isTrue(development("http://localhost:8081"))
    assert.isTrue(development("http://192.168.1.20:8081"))
    assert.isFalse(development("https://evil.example"))
    assert.isFalse(development("http://192.168.evil.example"))
    assert.isFalse(development("null"))
  })
})
