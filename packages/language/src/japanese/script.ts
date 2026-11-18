import { isKana, isRomaji, toHiragana, toKana, toRomaji } from "wanakana"

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々〆ヵヶ]/

export const hasJapanese = (text: string) => JAPANESE.test(text)

export const romanize = (kana: string) => toRomaji(kana)

export const romajiToKana = (text: string): string | null => {
  const trimmed = text.trim().toLowerCase()
  if (trimmed.length === 0 || !isRomaji(trimmed) || /\s/.test(trimmed)) return null
  // `wanakana` doesn't convert Hepburn's "tch" ("matcha") to っち unless rewritten as "cch".
  const kana = toHiragana(toKana(trimmed.replaceAll("tch", "cch")))
  return isKana(kana) ? kana : null
}

export const katakanaToHiragana = (text: string) => toHiragana(text, { passRomaji: true })

export const toFullwidth = (text: string) =>
  text.replace(/[\u0021-\u007e]/g, (ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0))
