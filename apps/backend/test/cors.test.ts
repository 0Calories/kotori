import { assert, describe, it } from "@effect/vitest"
import { webOriginAllowed } from "../src/http/cors.ts"

describe("web origins", () => {
  it("allows the configured web app, team-scoped preview subdomains, and local dev servers only outside production", () => {
    const production = webOriginAllowed(
      ["https://app.kotori.app", "https://kotori-*-0calories-projects.vercel.app"],
      true
    )
    assert.isTrue(production("https://app.kotori.app"))
    assert.isTrue(production("https://kotori-git-feat-preview-0calories-projects.vercel.app"))
    assert.isTrue(production("https://kotori-ap9b4s56r-0calories-projects.vercel.app"))
    assert.isFalse(production("https://kotori-evil.vercel.app"))
    assert.isFalse(production("https://kotori--0calories-projects.vercel.app"))
    assert.isFalse(production("https://kotori-sub.sub-0calories-projects.vercel.app"))
    assert.isFalse(production("https://kotori-abc-0calories-projects.vercel.app.evil.example"))
    assert.isFalse(production("http://kotori-abc-0calories-projects.vercel.app"))
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
