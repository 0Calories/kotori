// react-native-web's "on-drag" blurs on every scroll event, including iOS Safari's caret-tracking scrolls while typing.
export const keyboardDismissModeFor = (os: string): "none" | "on-drag" => (os === "web" ? "none" : "on-drag")

export const dragSlop = 8

// A horizontal slide selects text in the field; only a vertical drag dismisses.
export const pointerMovedEnough = (dx: number, dy: number): boolean =>
  Math.abs(dy) > dragSlop && Math.abs(dy) > Math.abs(dx)

export const blurFocusedOnScroll = (dragging: boolean): boolean => dragging

export const blurActiveTextField = (): void => {
  if (typeof document === "undefined") return
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur()
}
