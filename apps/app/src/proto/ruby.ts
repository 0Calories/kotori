// PROTOTYPE (the Perch entry page): furigana for a headword, which the dictionary gives only as a whole reading.
import { katakanaToHiragana, type RubySegment } from "@kotori/language"

/**
 * Kana that read as themselves: hiragana, katakana, and the long-vowel and kana iteration marks.
 * ヵ and ヶ (read か, が or こ) and 々 belong with the kanji they follow.
 */
const KANA = /[ぁ-ゖゝ-ゟァ-ヴヷ-ヺー-ヾ]/

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The headword split into runs, each run of kanji with its share of the reading and each run of
 * kana with none: 食う/くう → 食(く)う, 召し上がる/めしあがる → 召(め)し上(あ)がる,
 * ご苦労様/ごくろうさま → ご苦労様(くろうさま). The word's own kana anchor the split, so a run
 * of several kanji shares one reading; a word whose kana the reading doesn't contain (ateji, a
 * variant spelling) gets the whole reading over the whole word, and a word in kana gets none.
 */
export const alignReading = (headword: string, reading: string): ReadonlyArray<RubySegment> => {
  const runs: Array<{ text: string; kana: boolean }> = []
  for (const char of Array.from(headword)) {
    const kana = KANA.test(char)
    const last = runs.at(-1)
    if (last !== undefined && last.kana === kana) last.text += char
    else runs.push({ text: char, kana })
  }
  if (reading.length === 0 || runs.every((run) => run.kana)) return [{ text: headword, reading: null }]
  const pattern = new RegExp(
    `^${runs.map((run) => (run.kana ? escapeRegExp(katakanaToHiragana(run.text)) : "(.+?)")).join("")}$`
  )
  const match = pattern.exec(katakanaToHiragana(reading))
  if (match === null) return [{ text: headword, reading }]
  let group = 0
  return runs.map((run) => {
    if (run.kana) return { text: run.text, reading: null }
    group += 1
    return { text: run.text, reading: match[group] ?? null }
  })
}
