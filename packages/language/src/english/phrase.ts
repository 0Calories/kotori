import { normalizeGloss } from "./gloss.ts"

/** The words dictionaries write where an idiom takes anyone or anything: "get on one's nerves", "tell sb off". */
const POSSESSIVE_PLACEHOLDERS = ["one's", "ones", "someone's", "someones", "somebody's", "somebodys", "sb's"]
const OBJECT_PLACEHOLDERS = ["someone", "somebody", "sb"]
const REFLEXIVE_PLACEHOLDERS = ["oneself"]
const THING_PLACEHOLDERS = ["something", "sth", "sth's"]

/** The words learners type in a placeholder's place: "get on my nerves", "tell her off". */
const PERSONAL_POSSESSIVES = ["my", "your", "his", "her", "its", "our", "their"]
const PERSONAL_OBJECTS = ["me", "you", "him", "her", "us", "them"]
const PERSONAL_REFLEXIVES = ["myself", "yourself", "yourselves", "himself", "herself", "ourselves", "themselves"]

const ARTICLES = ["a", "an", "the"]

const POSSESSIVES = new Set([...POSSESSIVE_PLACEHOLDERS, ...PERSONAL_POSSESSIVES])
const OBJECTS = new Set([...OBJECT_PLACEHOLDERS, ...PERSONAL_OBJECTS])
const REFLEXIVES = new Set([...REFLEXIVE_PLACEHOLDERS, ...PERSONAL_REFLEXIVES])

/**
 * Placeholders Postgres's English configuration keeps as words; its stopword list already drops the
 * personal pronouns and articles.
 */
const IDIOM_PLACEHOLDERS = new Set([
  ...POSSESSIVE_PLACEHOLDERS,
  ...OBJECT_PLACEHOLDERS,
  ...REFLEXIVE_PLACEHOLDERS,
  ...THING_PLACEHOLDERS
])

/** Placeholders, pronouns and articles: the words that vary or drop out when learners look up a phrase. */
const PHRASE_FILLERS = new Set([...IDIOM_PLACEHOLDERS, ...POSSESSIVES, ...OBJECTS, ...REFLEXIVES, ...ARTICLES])

/** Words too common to tell phrases apart, which a relaxed search never counts as one of a phrase's words. */
const FUNCTION_WORDS = new Set([
  ...PHRASE_FILLERS,
  ..."to of in on at by for with from as into about".split(" "),
  ..."is are was were be been being".split(" ")
])

/**
 * Whether a word is too common to tell one English phrase from another: a placeholder, pronoun,
 * article, preposition or form of "be". The dictionary import uses it to require that a phrase it
 * recognises inside a longer gloss has some words of its own ("stone's throw", not "of a").
 */
export const isEnglishFunctionWord = (word: string) => FUNCTION_WORDS.has(word)

/** The spellings each placeholder slot is tried with, the dictionary's placeholders first. */
const POSSESSIVE_SLOT = ["one's", "someone's", "somebody's", ...PERSONAL_POSSESSIVES, ""]
const OBJECT_SLOT = ["someone", "somebody", "one", ...PERSONAL_OBJECTS, ""]
const REFLEXIVE_SLOT = ["oneself", ...PERSONAL_REFLEXIVES]
const SLOTS = [
  [POSSESSIVES, POSSESSIVE_SLOT],
  [OBJECTS, OBJECT_SLOT],
  [REFLEXIVES, REFLEXIVE_SLOT]
] as const

/** The words an idiom may have that a learner left out: "get on nerves", "pull together". */
const OMITTED_FILLERS = ["one's", "someone's", "someone", "oneself", "the", "a"]

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
 * pronouns or articles, with any pronoun or placeholder swapped for another of its kind
 * ("my" ↔ "one's" ↔ "someone's", "her" as either "his" or "him"), or with omitted fillers
 * restored, up to one before the last word and one after the first ("let cat out of bag" ->
 * "let the cat out of the bag").
 */
export const englishPhraseVariants = (text: string): Array<string> => {
  const norm = normalizeGloss(text)
  if (norm.length === 0) return []
  const variants = new Set<string>([norm, normalizeEnglishPhrase(text)])
  const words = norm.split(" ")
  if (words.length < 2) return [...variants]

  const replaceAt = (index: number, replacements: ReadonlyArray<string>) => {
    for (const replacement of replacements) {
      const next = words.toSpliced(index, 1, ...(replacement === "" ? [] : [replacement]))
      if (next.length > 0) variants.add(next.join(" "))
    }
  }

  let hadPronoun = false
  words.forEach((word, index) => {
    for (const [kind, slot] of SLOTS) {
      if (!kind.has(word)) continue
      hadPronoun = true
      replaceAt(index, slot)
    }
  })

  // When no pronoun was typed ("get on nerves", "beat around bush", "let the cat out of bag"),
  // try the two slots idioms put one in: before the last word and after the first.
  if (!hadPronoun && words.length <= 6) {
    const last = words.length - 1
    for (const filler of OMITTED_FILLERS) {
      variants.add(words.toSpliced(last, 0, filler).join(" "))
      if (words.length < 3) continue
      variants.add(words.toSpliced(1, 0, filler).join(" "))
      for (const second of OMITTED_FILLERS) {
        variants.add(words.toSpliced(last, 0, second).toSpliced(1, 0, filler).join(" "))
      }
    }
  }

  return [...variants]
}

const queryWords = (query: string) =>
  query
    .toLowerCase()
    .replace(/’/g, "'")
    .match(/[\p{L}\p{N}']+/gu) ?? []

const splitApostrophes = (words: ReadonlyArray<string>) => words.flatMap((word) => word.split("'").filter(Boolean))

/**
 * The words of an English query for a full-text search that requires all of them (Postgres's
 * `plainto_tsquery`), with idiom placeholders dropped when other words remain:
 * "get on one's nerves" -> "get on nerves". Null when the query has no words.
 */
export const englishSearchTerms = (query: string): string | null => {
  const words = queryWords(query)
  const content = splitApostrophes(words.filter((word) => !IDIOM_PLACEHOLDERS.has(word)))
  const terms = content.length > 0 ? content : splitApostrophes(words)
  return terms.length === 0 ? null : terms.join(" ")
}

/**
 * For a phrase of 3–6 content words where one was altered or omitted ("walk on thin ice" for
 * "skate on thin ice"), the searches that each leave one content word out. Empty otherwise:
 * with fewer words, leaving one out matches too much; with more, the phrase is a sentence.
 */
export const relaxedEnglishSearchTerms = (query: string): Array<string> => {
  const content = [
    ...new Set(
      queryWords(query)
        .filter((word) => !FUNCTION_WORDS.has(word))
        .map((word) => word.replace(/'s$/, ""))
        .filter((word) => word.length > 1)
    )
  ]
  if (content.length < 3 || content.length > 6) return []
  return content.map((_, drop) => content.toSpliced(drop, 1).join(" "))
}
