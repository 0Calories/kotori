import { type EntryRecord, normalizeGloss } from "@kotori/db"
import { romanize } from "@kotori/japanese"
import { uninflect } from "./inflect.ts"
import { emptySense, isEnglish, type Word } from "./words.ts"

/**
 * English words neither Wiktionary nor EJDict has, read backwards from JMDict: "selfie" is
 * a gloss of 自撮り, "hang out" of 遊ぶ, たむろする and 入り浸る. Each Japanese word that
 * has the English one as a gloss becomes one of its senses, most likely first.
 *
 * JMDict's glosses include descriptions as well as words ("clear autumnal weather"), so
 * only English that is attested as a word or phrase is taken: single words people use
 * (in the frequency list), phrases Wiktionary lists under a word, and phrasal verbs.
 */

/** Senses kept for a word: the most likely Japanese words for it. */
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
  readonly frequency: ReadonlyMap<string, number>
}

const attested = (term: string, known: KnownEnglish) => {
  const words = term.split(" ")
  if (words.length === 1) {
    // Single words: ones people use, and not inflections of words already in.
    return known.frequency.has(term) && !uninflect(term).some(({ base }) => known.words.has(base))
  }
  if (words.length > 4) return false
  return known.phrases.has(term) || (known.verbs.has(words[0]!) && words.slice(1).every((word) => PARTICLES.has(word)))
}

/** Reads JMDict an entry at a time, collecting the English words its glosses name; see `wordsFromJmdict`. */
export const jmdictReader = (known: KnownEnglish) => {
  const candidates = new Map<string, Array<Candidate>>()
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
        const score =
          (entry.common ? 30 : 0) +
          entry.priority / 5 +
          (SENSE_BONUS[senseIndex] ?? 0) -
          3 * position -
          (sense.misc.some((tag) => RARE.has(tag)) ? 25 : 0)
        if (known.words.has(term)) {
          if (!entry.common || senseIndex >= BACK_SENSES || position >= BACK_GLOSSES) return
          const spellings = translations.get(term) ?? new Map<string, number>()
          translations.set(term, spellings)
          for (const form of entry.forms) spellings.set(form.text, Math.max(spellings.get(form.text) ?? 0, score))
          return
        }
        if (!attested(term, known)) return
        const list = candidates.get(term) ?? []
        candidates.set(term, list)
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
      return {
        headword,
        ipa: null,
        spellings: [],
        inflections: [],
        senses: [...best.values()].slice(0, MAX_SENSES).map((candidate) => ({
          ...emptySense(),
          glosses: [{ text: candidate.japanese, type: null }],
          pos: [...candidate.pos]
        })),
        // A common Japanese word for it vouches for the count, and names are rarely hyphenated
        // ("ex-wife"). Otherwise the count may be a name's: 韓国海苔 is glossed "kim".
        mayBeName: !headword.includes("-") && !list.some((candidate) => candidate.common)
      }
    })

  /**
   * Per English word the dictionary already has (normalised), the spellings of the common
   * Japanese words JMDict translates with it, weighted as candidates are.
   */
  const backTranslations = (): ReadonlyMap<string, ReadonlyMap<string, number>> => translations

  return { add, finish, backTranslations }
}

export const wordsFromJmdict = (entries: Iterable<EntryRecord>, known: KnownEnglish): Array<Word> => {
  const reader = jmdictReader(known)
  for (const entry of entries) reader.add(entry)
  return reader.finish()
}
