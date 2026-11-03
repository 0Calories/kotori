import { assert, describe, it } from "vitest"
import { keyboardDismissModeFor } from "../src/lib/keyboard.ts"

describe("dismissing the keyboard from a scrolling screen", () => {
  it("does not blur on web scrolls, so iOS Safari keeps a field focused while typing", () => {
    // "on-drag" on web blurs the focused field on every scroll. iOS Safari emits
    // that scroll to keep the caret visible, once per character.
    assert.strictEqual(keyboardDismissModeFor("web"), "none")
  })

  it("still dismisses when a native scroll view is dragged", () => {
    assert.strictEqual(keyboardDismissModeFor("ios"), "on-drag")
    assert.strictEqual(keyboardDismissModeFor("android"), "on-drag")
  })
})
