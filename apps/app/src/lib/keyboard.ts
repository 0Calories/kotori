/**
 * `keyboardDismissMode` for a screen's scroller.
 *
 * react-native-web implements `"on-drag"` by blurring whichever field is focused
 * on every scroll event of that scroller. iOS Safari scrolls it to keep the caret
 * in view while the keyboard is up — when the keyboard opens, and again as the
 * caret moves — so a field such as Email blurs after each character and the
 * keyboard closes. `"none"` leaves those scrolls alone. Tapping outside a field
 * still dismisses the keyboard, which is what Safari does on its own.
 *
 * Native scroll views only report a drag when a finger actually drags, so
 * `"on-drag"` there does not fire while typing.
 */
export const keyboardDismissModeFor = (os: string): "none" | "on-drag" => (os === "web" ? "none" : "on-drag")
