import { normalizeGloss } from "./gloss.ts"

const POSSESSIVE_PLACEHOLDERS = ["one's", "ones", "someone's", "someones", "somebody's", "somebodys", "sb's"]
const OBJECT_PLACEHOLDERS = ["someone", "somebody", "sb"]
const REFLEXIVE_PLACEHOLDERS = ["oneself"]
const THING_PLACEHOLDERS = ["something", "sth", "sth's"]

const PERSONAL_POSSESSIVES = ["my", "your", "his", "her", "its", "our", "their"]
const PERSONAL_OBJECTS = ["me", "you", "him", "her", "us", "them"]
const PERSONAL_REFLEXIVES = ["myself", "yourself", "yourselves", "himself", "herself", "ourselves", "themselves"]

const ARTICLES = ["a", "an", "the"]

const POSSESSIVES = new Set([...POSSESSIVE_PLACEHOLDERS, ...PERSONAL_POSSESSIVES])
const OBJECTS = new Set([...OBJECT_PLACEHOLDERS, ...PERSONAL_OBJECTS])
const REFLEXIVES = new Set([...REFLEXIVE_PLACEHOLDERS, ...PERSONAL_REFLEXIVES])

// Postgres's `'english'` stopword list drops personal pronouns and articles, but keeps dictionary placeholders ("one's", "sb").
const IDIOM_PLACEHOLDERS = new Set([
  ...POSSESSIVE_PLACEHOLDERS,
  ...OBJECT_PLACEHOLDERS,
  ...REFLEXIVE_PLACEHOLDERS,
  ...THING_PLACEHOLDERS
])

const PHRASE_FILLERS = new Set([...IDIOM_PLACEHOLDERS, ...POSSESSIVES, ...OBJECTS, ...REFLEXIVES, ...ARTICLES])

const FUNCTION_WORDS = new Set([
  ...PHRASE_FILLERS,
  ..."to of in on at by for with from as into about".split(" "),
  ..."is are was were be been being".split(" ")
])

export const isEnglishFunctionWord = (word: string) => FUNCTION_WORDS.has(word)

const POSSESSIVE_SLOT = ["one's", "someone's", "somebody's", ...PERSONAL_POSSESSIVES, ""]
const OBJECT_SLOT = ["someone", "somebody", "one", ...PERSONAL_OBJECTS, ""]
const REFLEXIVE_SLOT = ["oneself", ...PERSONAL_REFLEXIVES]
const SLOTS = [
  [POSSESSIVES, POSSESSIVE_SLOT],
  [OBJECTS, OBJECT_SLOT],
  [REFLEXIVES, REFLEXIVE_SLOT]
] as const

const OMITTED_FILLERS = ["one's", "someone's", "someone", "oneself", "the", "a"]

export const normalizeEnglishPhrase = (text: string) => {
  const norm = normalizeGloss(text)
  const words = norm.split(" ").filter((word) => word.length > 0 && !PHRASE_FILLERS.has(word))
  return words.length > 0 ? words.join(" ") : norm
}

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

export const englishSearchTerms = (query: string): string | null => {
  const words = queryWords(query)
  const content = splitApostrophes(words.filter((word) => !IDIOM_PLACEHOLDERS.has(word)))
  const terms = content.length > 0 ? content : splitApostrophes(words)
  return terms.length === 0 ? null : terms.join(" ")
}

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
