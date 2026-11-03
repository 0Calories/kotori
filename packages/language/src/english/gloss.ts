/**
 * Normalises an English gloss or query for exact matching:
 * "to eat (a meal)" -> "eat", "The Sun" -> "sun".
 */
export const normalizeGloss = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the) /, "")

const POSSESSIVES = new Set([
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "one's",
  "ones",
  "someone's",
  "someones",
  "somebody's",
  "somebodys",
  "sb's"
])

const OBJECTS = new Set(["me", "you", "him", "us", "them", "someone", "somebody", "sb"])

const REFLEXIVES = new Set([
  "myself",
  "yourself",
  "yourselves",
  "himself",
  "herself",
  "ourselves",
  "themselves",
  "oneself"
])

const ARTICLES = new Set(["a", "an", "the"])

/** Idiom placeholders and articles that vary or drop out when learners look up a phrase. */
const PHRASE_FILLERS = new Set([...POSSESSIVES, ...OBJECTS, ...REFLEXIVES, ...ARTICLES, "something", "sth", "sth's"])

const CANONICAL_POSSESSIVES = ["one's", "someone's", "somebody's", ""] as const
const CANONICAL_OBJECTS = ["someone", "somebody", "one", "one's", "someone's", "somebody's", ""] as const
const INSERTED_FILLERS = ["one's", "someone's", "somebody's", "the", "a"] as const

/**
 * Normalises an English phrase with variable pronouns and articles stripped out, so
 * "get on my nerves", "get on nerves" and "to get on one's nerves" all become "get on nerves".
 * When every word is a filler ("someone", "myself"), the normalised word itself is kept.
 */
export const normalizeEnglishPhrase = (text: string) => {
  const norm = normalizeGloss(text)
  const words = norm.split(" ").filter((word) => word.length > 0 && !PHRASE_FILLERS.has(word))
  return words.length > 0 ? words.join(" ") : norm
}

/**
 * The ways a dictionary may write an English phrase looked up as `text`: as typed, without
 * pronouns or articles, with "my" / "me" / "myself" replaced by "one's" / "someone's" /
 * "oneself", or with an omitted placeholder restored ("get on nerves" -> "get on one's nerves").
 */
export const englishPhraseVariants = (text: string): Array<string> => {
  const norm = normalizeGloss(text)
  if (norm.length === 0) return []
  const variants = new Set<string>([norm, normalizeEnglishPhrase(text)])
  const words = norm.split(" ")
  if (words.length < 2) return [...variants]

  const replaceAt = (index: number, replacements: ReadonlyArray<string>) => {
    for (const replacement of replacements) {
      const next = [...words.slice(0, index), ...(replacement === "" ? [] : [replacement]), ...words.slice(index + 1)]
      if (next.length > 0) variants.add(next.join(" "))
    }
  }

  let hadPronoun = false
  words.forEach((word, index) => {
    if (POSSESSIVES.has(word)) {
      hadPronoun = true
      replaceAt(index, CANONICAL_POSSESSIVES)
    }
    if (OBJECTS.has(word)) {
      hadPronoun = true
      replaceAt(index, CANONICAL_OBJECTS)
    }
    if (REFLEXIVES.has(word)) {
      hadPronoun = true
      replaceAt(index, ["oneself"])
    }
  })

  // When no pronoun was typed ("get on nerves", "wrap head around", "beat around bush"),
  // try the two slots idioms put one: before the last word and after the first.
  if (!hadPronoun && words.length <= 5) {
    for (const filler of INSERTED_FILLERS) {
      variants.add([...words.slice(0, -1), filler, words[words.length - 1]!].join(" "))
      if (words.length >= 3) {
        variants.add([words[0]!, filler, ...words.slice(1)].join(" "))
      }
    }
  }

  return [...variants]
}

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
