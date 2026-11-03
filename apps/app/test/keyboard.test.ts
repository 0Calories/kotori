import { assert, describe, it } from "vitest"
import { blurFocusedOnScroll, keyboardDismissModeFor, pointerMovedEnough } from "../src/lib/keyboard.ts"

describe("dismissing the keyboard from a scrolling screen", () => {
  it("does not blur a web field when the scroller moves without a drag", () => {
    // Caret reveal on iOS Safari, and a mouse wheel or trackpad flick, are
    // scrolls with no vertical drag. "on-drag" on web would blur on all of them.
    assert.strictEqual(keyboardDismissModeFor("web"), "none")
    assert.strictEqual(blurFocusedOnScroll(false), false)
    assert.strictEqual(pointerMovedEnough(0, 0), false)
    assert.strictEqual(pointerMovedEnough(40, 2), false)
  })

  it("blurs a web field once a finger or mouse button has dragged vertically", () => {
    assert.strictEqual(pointerMovedEnough(0, 9), true)
    assert.strictEqual(pointerMovedEnough(4, -12), true)
    assert.strictEqual(blurFocusedOnScroll(true), true)
  })

  it("still dismisses when a native scroll view is dragged", () => {
    assert.strictEqual(keyboardDismissModeFor("ios"), "on-drag")
    assert.strictEqual(keyboardDismissModeFor("android"), "on-drag")
  })
})
