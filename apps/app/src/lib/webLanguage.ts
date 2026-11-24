import { Language } from "@kotori/contracts"
import * as Schema from "effect/Schema"

const isLanguage = Schema.is(Language)

/** Reads a language code from untrusted input (a URL parameter); anything outside the `Language` set is `null`. */
export const parseLanguage = (value: unknown): Language | null => (isLanguage(value) ? value : null)

/**
 * The language a web address asks for: `/ja` is the Japanese page, otherwise `?lang=`.
 * The path wins over the query, because `/ja` is served as Japanese HTML before the app loads.
 */
export const webLanguageFromLocation = (pathname: string, search: string): Language | null => {
  const clean = pathname.replace(/\/+$/, "") || "/"
  if (clean === "/ja") return "ja"
  return parseLanguage(new URLSearchParams(search).get("lang"))
}
