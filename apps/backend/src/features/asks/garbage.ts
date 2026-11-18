import type { AskRefusal, Language } from "@kotori/contracts"
import { hasJapanese, inOtherLanguage } from "@kotori/language"

const MAX_WORDS = 8

export const askable = (query: string, language: Language): boolean => {
  if (query.length < 2 || query.length > 64) return false
  if (query.split(" ").length > MAX_WORDS) return false
  if (!/\p{L}/u.test(query) || /[<>{}\\@#$%^*=_|~;:]|https?:|\/\//.test(query)) return false
  return language === "ja" ? hasJapanese(query) || /^[a-z0-9' -]+$/i.test(query) : /^[a-z0-9' .&/-]+$/i.test(query)
}

// Anchor to the whole token so stretched words like "nooooo" or "yessssss" are not rejected.
const HELD = /^(.)\1{4,}$/u
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"]
const KEYBOARD_RUN = 5

const keyboardRun = (token: string) =>
  KEYBOARD_ROWS.some((row) => {
    const both = [row, row.split("").toReversed().join("")]
    return both.some((line) => {
      for (let start = 0; start + KEYBOARD_RUN <= line.length; start++) {
        if (token.includes(line.slice(start, start + KEYBOARD_RUN))) return true
      }
      return false
    })
  })

export const turnAway = (query: string, language: Language): AskRefusal | null => {
  if (inOtherLanguage(query, language)) return "wrong_language"
  if (!askable(query, language)) return "not_askable"
  const tokens = query
    .toLowerCase()
    .split(/[\s'’-]+/)
    .filter((token) => token.length > 0)
  if (tokens.some((token) => HELD.test(token))) return "repetition"
  const words = tokens.filter((token) => /[a-z]/.test(token))
  if (language === "en" && words.some((token) => token.length >= KEYBOARD_RUN && keyboardRun(token))) return "keyboard"
  return null
}
