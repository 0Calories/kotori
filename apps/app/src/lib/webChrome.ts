import type { Language } from "@kotori/contracts"

/**
 * Keeps the web document chrome (status bar `theme-color`, page background behind
 * overscroll/safe areas, and `<html lang>`) matched to the active theme and language.
 */
export const syncWebTheme = (backgroundColor: string, doc: Document | undefined = globalThis.document): void => {
  if (doc === undefined) return
  doc.documentElement.style.backgroundColor = backgroundColor
  if (doc.body) doc.body.style.backgroundColor = backgroundColor
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta === null) {
    meta = doc.createElement("meta")
    meta.name = "theme-color"
    doc.head?.appendChild(meta)
  }
  meta.content = backgroundColor
}

/** Updates `<html lang>` on the web so screen readers, spellcheck and CJK glyphs match the UI language. */
export const syncWebLanguage = (language: Language, doc: Document | undefined = globalThis.document): void => {
  if (doc === undefined) return
  doc.documentElement.lang = language
}

/** Formats a browser tab title (`"Part · Kotori"` or `"Kotori"`) around the app name in the interface language. */
export const formatDocumentTitle = (
  parts: string | ReadonlyArray<string | undefined> | undefined,
  appName: string
): string => {
  const list = (Array.isArray(parts) ? parts : [parts]).filter(
    (part): part is string => typeof part === "string" && part.length > 0 && part !== appName
  )
  return list.length > 0 ? `${list.join(" · ")} · ${appName}` : appName
}
