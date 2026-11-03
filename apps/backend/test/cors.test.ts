import { assert, describe, it } from "@effect/vitest"
import { webOriginAllowed } from "../src/http/cors.ts"

describe("web origins", () => {
  it("allows the configured web app, and local dev servers only outside production", () => {
    const production = webOriginAllowed(["https://app.kotori.app"], true)
    assert.isTrue(production("https://app.kotori.app"))
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
