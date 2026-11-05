import type { AskRefusal, Language } from "@kotori/contracts"
import { hasJapanese, inOtherLanguage } from "@kotori/language"

const MAX_WORDS = 8

/**
 * Whether a query is worth asking anyone about at all: short, in a plausible script, and not
 * markup or numbers. Looser than the dictionary's own notions on purpose — new slang is the
 * point — while keeping URLs, code and keyboard mash out of the spend.
 */
export const askable = (query: string, language: Language): boolean => {
  if (query.length < 2 || query.length > 64) return false
  if (query.split(" ").length > MAX_WORDS) return false
  if (!/\p{L}/u.test(query) || /[<>{}\\@#$%^*=_|~;:]|https?:|\/\//.test(query)) return false
  // A Japanese word may be asked in kana, kanji or rōmaji; an English one in English letters.
  return language === "ja" ? hasJapanese(query) || /^[a-z0-9' -]+$/i.test(query) : /^[a-z0-9' .&/-]+$/i.test(query)
}

/** One character held down: "aaaaaaa", "アアアアアア". Stretched words ("nooooo", "hmmmmm", "yessssss") aren't one character. */
const HELD = /^(.)\1{4,}$/u
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"]
const KEYBOARD_RUN = 5

/** Five keys in a row along a keyboard row, either way: "asdfg", "poiuy". */
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

/**
 * Stage zero of Ask Kotori: why a normalized query is turned away before anyone is asked about
 * it, or null to go on to Jev. Free, and conservative on purpose: slang, interjections, loanwords
 * and misspellings must get through, so each rule fires only on shapes no word has, and Jev's
 * `garbage` route catches the mash they let by. Queries in the learner's own language are turned
 * away too (`inOtherLanguage`): Ask Kotori looks into the language being learned.
 */
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
