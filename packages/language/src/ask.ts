import { hasJapanese, romajiToKana } from "./japanese/script.ts"

export const normalizeAsk = (query: string, language: "en" | "ja") => {
  const clean = query
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’)）」』]+$/gu, "")
  return language === "en" ? clean.toLowerCase() : clean
}

const LATIN_WORDS = /^[a-z0-9' -]+$/i

const readsAsRomaji = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s'’-]+/)
    .filter((word) => word.length > 0)
    .every((word) => romajiToKana(word) !== null)

export const inOtherLanguage = (query: string, language: "en" | "ja") =>
  language === "en"
    ? hasJapanese(query)
    : !hasJapanese(query) && /\p{L}/u.test(query) && LATIN_WORDS.test(query) && !readsAsRomaji(query)
