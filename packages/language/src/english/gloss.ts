/**
 * Normalises an English gloss or query for exact matching:
 * "to eat (a meal)" -> "eat", "The Sun" -> "sun".
 */
export const normalizeGloss = (text: string) =>
  text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the) /, "")

/** Bracketed asides in a gloss, innermost first: (…), 〈…〉, 《…》, 〔…〕 and […] after NFKC. */
const ASIDE = /\([^()]*\)|〈[^〈〉]*〉|《[^《》]*》|〔[^〔〕]*〕|\[[^[\]]*\]/g

/**
 * Normalises a Japanese gloss or query for exact matching, the way `normalizeGloss` does
 * English: "～を食べる。" -> "食べる", "（資源や金銭を）消費する" -> "消費する", "『走る』" -> "走る".
 */
export const normalizeJapaneseGloss = (text: string) => {
  let norm = text.normalize("NFKC")
  // Twice, for an aside inside an aside.
  norm = norm.replace(ASIDE, "").replace(ASIDE, "")
  return norm
    .replace(/[『』「」【】"]/g, "")
    .replace(/^\s*[~〜…・.]+\s*(?:を|に|が|と|で|の|へ|から|より)?/, "")
    .replace(/[\s。、.,!?！？・;；:：]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** A word written in katakana alone, as loanwords are (スタイル, コーヒー); valid in JavaScript and Postgres. */
export const KATAKANA_WORD = "^[゠-ヿ]+$"

/**
 * The parts of a dictionary entry the loan search reads. Structural, so `EntryRecord`
 * satisfies it without this package depending on the schema.
 */
export interface GlossedEntry {
  readonly id: number
  /** The headword's language, and so which language the glosses are in: the other one. */
  readonly language: string
  readonly headword: string
  readonly common: boolean
  readonly priority: number
  readonly senses: ReadonlyArray<{
    readonly glosses: ReadonlyArray<{ readonly text: string }>
    /** The English words a loanword sense comes from, where JMDict names them (`lsource`). */
    readonly sources: ReadonlyArray<string>
  }>
}

/** A katakana word that may be the loanword of an English word, and how the dictionary ties them. */
export interface LoanCandidate {
  /** The English word, normalised (`normalizeGloss`). */
  readonly word: string
  readonly entryId: number
  /** `gloss`: the entry has the word as a gloss; `source`: JMDict names it as the loan's source. */
  readonly by: "gloss" | "source"
}

/**
 * The loan candidates of English words among `entries`: common katakana words with the word as
 * a gloss or as their JMDict source, most frequent first, at most `limit` per word.
 * The backend's `loanCandidates` query is the same search in SQL; the golden fixture is cut with this.
 */
export const loanCandidatesIn = (
  entries: Iterable<GlossedEntry>,
  words: ReadonlyArray<string>,
  limit: number
): Array<LoanCandidate> => {
  const wanted = new Set(words.map(normalizeGloss).filter((word) => word.length > 1))
  const katakana = new RegExp(KATAKANA_WORD, "u")
  const found = new Map<string, Array<LoanCandidate & { readonly priority: number }>>()
  for (const entry of entries) {
    if (entry.language !== "ja" || !entry.common || !katakana.test(entry.headword)) continue
    const by = new Map<string, LoanCandidate["by"]>()
    for (const sense of entry.senses) {
      for (const gloss of sense.glosses) {
        const word = normalizeGloss(gloss.text)
        if (wanted.has(word) && !by.has(word)) by.set(word, "gloss")
      }
      for (const source of sense.sources) {
        const word = normalizeGloss(source)
        if (wanted.has(word)) by.set(word, "source")
      }
    }
    for (const [word, how] of by) {
      found.set(word, [...(found.get(word) ?? []), { word, entryId: entry.id, by: how, priority: entry.priority }])
    }
  }
  return [...found.values()].flatMap((candidates) =>
    candidates
      .sort((a, b) => b.priority - a.priority || a.entryId - b.entryId)
      .slice(0, limit)
      .map(({ word, entryId, by }) => ({ word, entryId, by }))
  )
}
