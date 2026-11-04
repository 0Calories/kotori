import type { EntryRecord } from "@kotori/contracts"
import { normalizeGloss, romanize, uninflect } from "@kotori/language"
import { addRedirect, emptySense, type FormOf, isEnglish, type Word } from "./words.ts"

/**
 * English words the other sources lack, read backwards from JMDict: "selfie" is a gloss of
 * 自撮り, "hang out" of 遊ぶ, たむろする and 入り浸る. Synonymous Japanese words sharing a
 * part of speech are grouped into shared senses, most likely first.
 *
 * JMDict's glosses include descriptions as well as words ("clear autumnal weather"), so
 * only English that is attested as a word or phrase is taken: single words people use
 * (in the frequency list), phrases Wiktionary lists, and phrasal verbs.
 */

/** Senses kept for a word, and glosses kept per sense: the most likely Japanese words for it. */
const MAX_SENSES = 6

/** The particles of phrasal verbs: "hang out", "run out of", "put up with". */
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

/** Explanations, literal renderings and trademarks aren't English words. */
const SKIPPED_TYPES = new Set(["expl", "lit", "tm"])

/** JMDict parts of speech → the English codes a Japanese word lends the English one. */
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

/** The same ranking search uses: common words, early senses and first glosses go first. */
const SENSE_BONUS = [40, 25, 15, 10, 5]
const RARE = new Set(["arch", "obs", "obsc", "rare", "hist", "vulg", "X", "derog"])

interface Candidate {
  readonly japanese: string
  /** Whether JMDict marks the Japanese word common. */
  readonly common: boolean
  readonly pos: ReadonlyArray<string>
  readonly score: number
}

/** Back-translations are read from a Japanese word's leading senses and glosses, where JMDict puts the common ones. */
const BACK_SENSES = 3
const BACK_GLOSSES = 4

export interface KnownEnglish {
  /** Lowercased headwords, spellings and inflections of the words already in the dictionary. */
  readonly words: ReadonlySet<string>
  /** Lowercased verbs, for recognising phrasal verbs. */
  readonly verbs: ReadonlySet<string>
  /** Lowercased phrases Wiktionary lists under a word. */
  readonly phrases: ReadonlySet<string>
  /** Variant idiom phrasings mapped to their canonical headword ("skate on thin ice" -> "on thin ice"). */
  readonly redirects?: ReadonlyMap<string, string> | undefined
  readonly frequency: ReadonlyMap<string, number>
}

/** Reads JMDict an entry at a time, collecting the English words its glosses name; see `wordsFromJmdict`. */
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
      // Single words: ones people use, and not inflections of words already in.
      return known.frequency.has(term) && !uninflect(term).some(({ base }) => known.words.has(base))
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
    return null
  }

  const candidates = new Map<string, Array<Candidate>>()
  const variants = new Map<string, Set<string>>()
  // Per English word already in the dictionary: the spellings of the common Japanese words that
  // JMDict translates with it, each with its best weight as a candidate, as evidence of which
  // of the English word's senses are in common use.
  const translations = new Map<string, Map<string, number>>()

  const add = (entry: EntryRecord) => {
    const romaji = romanize(entry.reading)
    entry.senses.forEach((sense, senseIndex) => {
      sense.glosses.forEach((gloss, position) => {
        // Capitalised glosses are names ("Disney"); lowercase ones are words.
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
        // A common Japanese word for it vouches for the count, and names are rarely hyphenated
        // ("ex-wife") or multi-word phrases. Otherwise the count may be a name's: 韓国海苔 is glossed "kim".
        mayBeName: !headword.includes(" ") && !headword.includes("-") && !list.some((candidate) => candidate.common)
      }
    })

  const formsOf = (): Array<FormOf> =>
    [...variants].flatMap(([base, set]) => [...set].map((text): FormOf => ({ text, base, tags: [] })))

  /**
   * Per English word the dictionary already has (normalised), the spellings of the common
   * Japanese words JMDict translates with it, weighted as candidates are.
   */
  const backTranslations = (): ReadonlyMap<string, ReadonlyMap<string, number>> => translations

  return { add, finish, formsOf, backTranslations }
}

export const wordsFromJmdict = (entries: Iterable<EntryRecord>, known: KnownEnglish): Array<Word> => {
  const reader = jmdictReader(known)
  for (const entry of entries) reader.add(entry)
  return reader.finish()
}
