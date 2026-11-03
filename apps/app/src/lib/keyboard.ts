/**
 * `keyboardDismissMode` for a screen's scroller.
 *
 * react-native-web treats `"on-drag"` as "blur the focused field on every
 * `scroll` event". iOS Safari scrolls the screen to keep the caret in view
 * while the keyboard is up, including after each character, so that mode
 * closes the keyboard mid-word. Web passes `"none"` and blurs only from
 * `blurFocusedOnScroll`, once the pointer has actually dragged. Native scroll
 * views only emit a drag when a finger drags, so `"on-drag"` there does not
 * fire while typing.
 */
export const keyboardDismissModeFor = (os: string): "none" | "on-drag" => (os === "web" ? "none" : "on-drag")

/** Vertical movement, in px, before a web scroll counts as a drag rather than a tap. */
export const dragSlop = 8

/** A horizontal slide selects text in the field. Only a vertical drag dismisses. */
export const pointerMovedEnough = (dx: number, dy: number): boolean =>
  Math.abs(dy) > dragSlop && Math.abs(dy) > Math.abs(dx)

/**
 * Whether a web scroll should blur the focused field. `dragging` is true only
 * after `pointerMovedEnough`. Caret reveal, a mouse wheel, and a trackpad
 * flick scroll with no drag, so they leave the field focused. Tapping empty
 * space still blurs, because the browser moves focus on its own.
 */
export const blurFocusedOnScroll = (dragging: boolean): boolean => dragging

/** Blur the field the browser is typing into, if it is a text field. */
export const blurActiveTextField = (): void => {
  if (typeof document === "undefined") return
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur()
}
