import { hasJapanese, romajiToKana } from "./japanese/script.ts"

/**
 * An Ask Kotori query as asked and cached, so the app finds a past answer under the key the
 * server stored it by. English is asked lowercase; a word and its capitalisation are one
 * question. Stray punctuation and emoji around the words come off first.
 */
export const normalizeAsk = (query: string, language: "en" | "ja") => {
  const clean = query
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’)）」』]+$/gu, "")
  return language === "en" ? clean.toLowerCase() : clean
}

/** Latin words, as a query in rōmaji (or a mistyped English one) is written. */
const LATIN_WORDS = /^[a-z0-9' -]+$/i

/** Whether every word of Latin text reads as rōmaji. */
const readsAsRomaji = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s'’-]+/)
    .filter((word) => word.length > 0)
    .every((word) => romajiToKana(word) !== null)

/**
 * Whether a query asked of the `language` dictionary is written in the other language: Japanese
 * script for English, or Latin words that don't read as rōmaji for Japanese. Search answers in
 * both directions, but Ask Kotori only looks into words of the language being learned, so the
 * app doesn't offer it for these and the server turns them away.
 */
export const inOtherLanguage = (query: string, language: "en" | "ja") =>
  language === "en"
    ? hasJapanese(query)
    : !hasJapanese(query) && /\p{L}/u.test(query) && LATIN_WORDS.test(query) && !readsAsRomaji(query)
