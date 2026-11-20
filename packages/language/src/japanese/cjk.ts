/** Contiguous runs of kana and CJK ideographs (including `々` and prolonged sound mark `ー`). */
const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u30fc]+/gu

/** CJK ideographs (Unified Ideographs, Extension A, Compatibility Ideographs, and `々`). */
const KANJI = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005]$/u

/**
 * Extracts deduplicated overlapping CJK/kana character bigrams and single-character kanji unigrams
 * from `text` (NFKC-normalized). Used to populate and query `entry_search.cjk_tokens` so 1–2
 * character kanji words and short Japanese substrings hit the GIN index without falling below
 * 3-character trigram floors.
 */
export const cjkSearchTokens = (text: string): Array<string> => {
  const normalized = text.normalize("NFKC")
  const tokens = new Set<string>()
  const runs = normalized.match(CJK_RUN) ?? []
  for (const run of runs) {
    const chars = Array.from(run)
    for (let i = 0; i + 1 < chars.length; i++) {
      tokens.add(chars[i]! + chars[i + 1]!)
    }
    for (const ch of chars) {
      if (KANJI.test(ch)) tokens.add(ch)
    }
  }
  return [...tokens]
}
