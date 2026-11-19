import type { EntryRecord } from "@kotori/contracts"
import { isEnglishFunctionWord, normalizeGloss, romanize, uninflect } from "@kotori/language"
import { addRedirect, emptySense, type FormOf, isEnglish, type Word } from "./words.ts"

const MAX_SENSES = 6

const PARTICLES = new Set([
  "up",
  "down",
  "out",
  "off",
  "on",
  "in",
  "over",
  "away",
  "back",
  "around",
  "round",
  "through",
  "along",
  "about",
  "into",
  "onto",
  "of",
  "with",
  "for",
  "to",
  "by",
  "across",
  "apart",
  "together",
  "forward",
  "behind",
  "after"
])

const VERB_PREFIXES = [
  "find oneself ",
  "be ",
  "get ",
  "go ",
  "walk ",
  "tread ",
  "skate ",
  "sit ",
  "stand ",
  "stay ",
  "keep ",
  "put ",
  "leave "
]

const PREP_PREFIXES = ["on ", "in ", "at ", "under ", "out of ", "behind ", "beyond ", "above ", "below ", "off "]

const FRAME_WORDS = new Set([
  ...PARTICLES,
  "a",
  "an",
  "the",
  "at",
  "within",
  "just",
  "only",
  "right",
  "be",
  "being",
  "is",
  "are",
  "was",
  "were",
  "get",
  "getting",
  "someone",
  "somebody",
  "something",
  "oneself",
  "one's",
  "someone's"
])

const MAX_FRAME = 3

const contentWords = (words: ReadonlyArray<string>) => words.filter((word) => !isEnglishFunctionWord(word)).length

const framedPhrase = (words: ReadonlyArray<string>, attested: (phrase: string) => boolean): string | null => {
  for (let length = words.length - 1; length >= 2; length--) {
    for (let start = 0; start + length <= words.length; start++) {
      const inside = words.slice(start, start + length)
      const frame = [...words.slice(0, start), ...words.slice(start + length)]
      if (frame.length > MAX_FRAME || !frame.every((word) => FRAME_WORDS.has(word))) continue
      // Require two content words so function-word pairs in the phrase index ("of a", "on the") do not claim unrelated glosses.
      if (contentWords(inside) < 2) continue
      const phrase = inside.join(" ")
      if (attested(phrase)) return phrase
    }
  }
  return null
}

const OBJECT_SWAPS = new Map<string, ReadonlyArray<string>>([
  ...["me", "you", "him", "us", "them"].map((word) => [word, ["someone", "somebody"]] as const),
  ["her", ["someone", "somebody", "one's", "someone's"]],
  ["someone", ["somebody", "you", "me"]],
  ["somebody", ["someone", "you", "me"]]
])

const POSSESSIVE_SWAPS = new Map<string, ReadonlyArray<string>>([
  ...["my", "your", "his", "our", "their"].map((word) => [word, ["one's", "someone's"]] as const),
  ["one's", ["someone's", "your", "my"]],
  ["someone's", ["one's", "your", "my"]],
  ["somebody's", ["one's", "someone's", "your", "my"]]
])

const REFLEXIVE_SWAPS = new Map<string, ReadonlyArray<string>>([
  ...["myself", "yourself", "yourselves", "himself", "herself", "ourselves", "themselves"].map(
    (word) => [word, ["oneself"]] as const
  ),
  ["oneself", ["yourself", "myself"]]
])

const placeholderForms = (term: string): Array<string> => {
  const words = term.split(" ")
  if (words.length < 2 || words.length > 7) return []
  const first = words[0]!
  const stems = new Set<string>([first, ...uninflect(first).map(({ base }) => base)])
  if (!first.endsWith("s")) stems.add(`${first}s`)
  const results = new Set<string>()
  for (const stem of stems) {
    const baseWords = [stem, ...words.slice(1)]
    const joined = baseWords.join(" ")
    if (joined !== term) results.add(joined)
    baseWords.forEach((word, index) => {
      const replacements = [
        ...(REFLEXIVE_SWAPS.get(word) ?? []),
        ...(words.length >= 3 ? [...(OBJECT_SWAPS.get(word) ?? []), ...(POSSESSIVE_SWAPS.get(word) ?? [])] : [])
      ]
      for (const replacement of replacements) {
        const candidate = baseWords.toSpliced(index, 1, replacement).join(" ")
        if (candidate !== term) results.add(candidate)
      }
    })
  }
  return [...results]
}

const SKIPPED_TYPES = new Set(["expl", "lit", "tm"])

const partOfSpeech = (codes: ReadonlyArray<string>): Array<string> => {
  for (const code of codes) {
    if (/^v(?!s$)/.test(code)) return ["v"]
    if (code.startsWith("n") || code === "vs") return ["n"]
    if (code.startsWith("adj")) return ["adj"]
    if (code.startsWith("adv")) return ["adv"]
    if (["int", "exp", "pn", "conj", "num", "pref", "suf"].includes(code)) return [code]
  }
  return []
}

const SENSE_BONUS = [40, 25, 15, 10, 5]
const RARE = new Set(["arch", "obs", "obsc", "rare", "hist", "vulg", "X", "derog"])

interface Candidate {
  readonly japanese: string
  readonly common: boolean
  readonly pos: ReadonlyArray<string>
  readonly score: number
}

const BACK_SENSES = 3
const BACK_GLOSSES = 4

export interface KnownEnglish {
  readonly words: ReadonlySet<string>
  readonly verbs: ReadonlySet<string>
  readonly phrases: ReadonlySet<string>
  readonly redirects?: ReadonlyMap<string, string> | undefined
  readonly subtitles: ReadonlyMap<string, number>
}

export const jmdictReader = (known: KnownEnglish) => {
  const phrases = new Set<string>()
  const redirects = new Map<string, string>()
  const addPhrase = (phrase: string) => {
    const canonical = phrase.trim().toLowerCase()
    const norm = normalizeGloss(canonical)
    if (!norm.includes(" ")) return
    phrases.add(norm)
    if (norm !== canonical && !redirects.has(norm)) redirects.set(norm, canonical)
  }
  for (const word of known.words) addPhrase(word)
  for (const phrase of known.phrases) addPhrase(phrase)
  for (const [from, to] of known.redirects ?? []) {
    if (addRedirect(redirects, from, to)) addPhrase(to)
  }

  const resolveHeadword = (term: string): { readonly headword: string; readonly variant?: string } | null => {
    const words = term.split(" ")
    if (words.length === 1) {
      if (known.words.has(term)) return { headword: term }
      return known.subtitles.has(term) && !uninflect(term).some(({ base }) => known.words.has(base))
        ? { headword: term }
        : null
    }
    const redirected = redirects.get(term)
    if (words.length > 7) {
      const candidate = redirected ?? term
      return known.words.has(candidate) ? { headword: candidate } : null
    }
    if (redirected !== undefined) {
      return term === normalizeGloss(redirected) ? { headword: redirected } : { headword: redirected, variant: term }
    }
    if (known.words.has(term)) return { headword: term }
    const candidates = placeholderForms(term)
    for (const candidate of candidates) {
      const target = redirects.get(candidate)
      if (target !== undefined && known.words.has(target)) return { headword: target, variant: term }
      if (known.words.has(candidate)) return { headword: candidate, variant: term }
    }
    for (const prefix of VERB_PREFIXES) {
      if (term.startsWith(prefix)) {
        const tail = term.slice(prefix.length)
        if (PREP_PREFIXES.some((prep) => tail.startsWith(prep)) && phrases.has(tail)) {
          return { headword: redirects.get(tail) ?? tail, variant: term }
        }
      }
    }
    if (phrases.has(term) || (known.verbs.has(words[0]!) && words.slice(1).every((word) => PARTICLES.has(word)))) {
      return { headword: term }
    }
    for (const candidate of candidates) {
      const target = redirects.get(candidate)
      if (target !== undefined) return { headword: target, variant: term }
      if (phrases.has(candidate)) return { headword: candidate, variant: term }
    }
    const framed = framedPhrase(words, (phrase) => phrases.has(phrase) || redirects.has(phrase))
    if (framed !== null) return { headword: redirects.get(framed) ?? framed, variant: term }
    return null
  }

  const candidates = new Map<string, Array<Candidate>>()
  const variants = new Map<string, Set<string>>()
  const translations = new Map<string, Map<string, number>>()

  const add = (entry: EntryRecord) => {
    const romaji = romanize(entry.reading)
    entry.senses.forEach((sense, senseIndex) => {
      sense.glosses.forEach((gloss, position) => {
        // Skip capitalized glosses, which in JMdict are proper nouns ("Disney").
        if ((gloss.type !== null && SKIPPED_TYPES.has(gloss.type)) || !/^[a-z]/.test(gloss.text)) return
        const term = normalizeGloss(gloss.text)
        if (term.length < 2 || !isEnglish(term) || term === romaji) return
        const resolved = resolveHeadword(term)
        if (resolved === null) return
        const { headword, variant } = resolved
        if (variant !== undefined && variant !== headword && !known.words.has(variant)) {
          const set = variants.get(headword) ?? new Set<string>()
          set.add(variant)
          variants.set(headword, set)
        }
        const score =
          (entry.common ? 30 : 0) +
          entry.priority / 5 +
          (SENSE_BONUS[senseIndex] ?? 0) -
          3 * position -
          (sense.misc.some((tag) => RARE.has(tag)) ? 25 : 0)
        const isIdiomOrCommon =
          entry.common || sense.pos.includes("exp") || sense.misc.includes("id") || sense.misc.includes("proverb")
        const recordTranslation = () => {
          if (senseIndex >= BACK_SENSES || position >= BACK_GLOSSES || score <= 0) return
          const spellings = translations.get(headword) ?? new Map<string, number>()
          translations.set(headword, spellings)
          const forms = entry.forms.length > 0 ? entry.forms.map((form) => form.text) : [entry.headword]
          for (const text of forms) spellings.set(text, Math.max(spellings.get(text) ?? 0, score))
        }
        if (known.words.has(headword)) {
          if (isIdiomOrCommon) recordTranslation()
          return
        }
        if (headword.includes(" ") && isIdiomOrCommon) recordTranslation()
        const list = candidates.get(headword) ?? []
        candidates.set(headword, list)
        list.push({ japanese: entry.headword, common: entry.common, pos: partOfSpeech(sense.pos), score })
      })
    })
  }

  const finish = (): Array<Word> =>
    [...candidates].map(([headword, list]) => {
      const best = new Map<string, Candidate>()
      for (const candidate of list.toSorted((a, b) => b.score - a.score)) {
        if (!best.has(candidate.japanese)) best.set(candidate.japanese, candidate)
      }
      const byPos = new Map<
        string,
        { readonly pos: Array<string>; readonly glosses: Array<{ text: string; type: null }> }
      >()
      for (const candidate of best.values()) {
        const key = candidate.pos[0] ?? "exp"
        let group = byPos.get(key)
        if (group === undefined) {
          group = { pos: [...candidate.pos], glosses: [] }
          byPos.set(key, group)
        }
        if (group.glosses.length < MAX_SENSES) {
          group.glosses.push({ text: candidate.japanese, type: null })
        }
      }
      return {
        headword,
        ipa: null,
        spellings: [...(variants.get(headword) ?? [])],
        inflections: [],
        senses: [...byPos.values()].slice(0, MAX_SENSES).map((group) => ({
          ...emptySense(),
          glosses: group.glosses,
          pos: group.pos
        })),
        // Single unhyphenated words without a common JMdict source may match proper-noun subtitle counts (e.g. 韓国海苔 glossed "kim").
        mayBeName: !headword.includes(" ") && !headword.includes("-") && !list.some((candidate) => candidate.common)
      }
    })

  const formsOf = (): Array<FormOf> =>
    [...variants].flatMap(([base, set]) => [...set].map((text): FormOf => ({ text, base, tags: [] })))

  const backTranslations = (): ReadonlyMap<string, ReadonlyMap<string, number>> => translations

  return { add, finish, formsOf, backTranslations }
}

export const wordsFromJmdict = (entries: Iterable<EntryRecord>, known: KnownEnglish): Array<Word> => {
  const reader = jmdictReader(known)
  for (const entry of entries) reader.add(entry)
  return reader.finish()
}
