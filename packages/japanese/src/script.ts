import { isKana, isRomaji, toHiragana, toKana, toRomaji } from "wanakana"

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々〆ヵヶ]/

/** True when the text contains any kana or kanji. */
export const hasJapanese = (text: string) => JAPANESE.test(text)

/** Hepburn romanisation of kana, for display. */
export const romanize = (kana: string) => toRomaji(kana)

/**
 * Interprets Latin input as romaji, returning hiragana when the whole query
 * converts cleanly ("taberu" -> "たべる"), or null when it doesn't ("hello world").
 */
export const romajiToKana = (text: string): string | null => {
  const trimmed = text.trim().toLowerCase()
  if (trimmed.length === 0 || !isRomaji(trimmed) || /\s/.test(trimmed)) return null
  const kana = toHiragana(toKana(trimmed))
  return isKana(kana) ? kana : null
}

export const katakanaToHiragana = (text: string) => toHiragana(text, { passRomaji: true })
