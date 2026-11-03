import { EntryId, type EntryRecord, type FormRecord, type SenseRecord } from "@kotori/contracts"
import { type EnglishInflection, normalizeJapaneseGloss } from "@kotori/language"
import type { FormOf, InflectedForm, References, Word } from "./words.ts"

/** English entries are numbered from here, well above JMDict's sequence numbers (at most 9,999,999). */
const FIRST_ENGLISH_ID = 100_000_000

/** How many of the most used words count as common, as JMDict's markers make about a tenth of its words common. */
const COMMON_WORDS = 10_000

/** A word as the dictionary will hold it. */
export interface Built {
  readonly headword: string
  ipa: string | null
  readonly familiarity?: number | undefined
  readonly spellings: Set<string>
  readonly inflections: Map<string, Set<EnglishInflection>>
  readonly senses: Word["senses"]
  readonly references: ReadonlyArray<References>
}

const built = (word: Word): Built => ({
  headword: word.headword,
  ipa: word.ipa,
  familiarity: word.familiarity,
  spellings: new Set(word.spellings.filter((spelling) => spelling !== word.headword)),
  inflections: new Map(word.inflections.map((form) => [form.text, new Set(form.tags)])),
  senses: word.senses,
  references: word.references ?? []
})

const addInflection = (word: Built, form: InflectedForm) => {
  if (form.text === word.headword) return
  const tags = word.inflections.get(form.text) ?? new Set<EnglishInflection>()
  for (const tag of form.tags) tags.add(tag)
  word.inflections.set(form.text, tags)
}

export interface Sources {
  readonly wiktionary: {
    readonly words: ReadonlyArray<Word>
    readonly formsOf?: ReadonlyArray<FormOf> | undefined
  }
}

/**
 * Prepares the dictionary's words and attaches any standalone `form-of` entries onto
 * their base headwords. Case tells words apart ("Polish", "polish", "GOAT", "goat").
 */
export const mergeSources = (sources: Sources): Array<Built> => {
  const words = new Map<string, Built>()
  for (const word of sources.wiktionary.words) {
    if (!words.has(word.headword)) words.set(word.headword, built(word))
  }

  const folded = new Map<string, Built>()
  for (const word of words.values()) {
    if (!folded.has(word.headword.toLowerCase())) folded.set(word.headword.toLowerCase(), word)
  }
  for (const form of sources.wiktionary.formsOf ?? []) {
    const base = words.get(form.base) ?? folded.get(form.base.toLowerCase())
    if (base === undefined || form.text === base.headword) continue
    if (form.tags.length === 0) base.spellings.add(form.text)
    else addInflection(base, { text: form.text, tags: form.tags })
  }
  return [...words.values()]
}

/** A sense's glosses as they are looked up, to compare one word's meanings with another's. */
const meanings = (sense: SenseRecord) => new Set(sense.glosses.map((gloss) => normalizeJapaneseGloss(gloss.text)))

/** Pairs of characters with a kanji or katakana in them: 食事 in both 食事をする and 食事をとる. Kana-only pairs (させ) say little. */
const bigrams = (glosses: Iterable<string>) => {
  const pairs = new Set<string>()
  for (const gloss of glosses) {
    for (let index = 0; index + 1 < gloss.length; index++) {
      const pair = gloss.slice(index, index + 2)
      if (/[\u4e00-\u9fff\u30a0-\u30ff]/.test(pair)) pairs.add(pair)
    }
  }
  return pairs
}

const overlap = <A>(a: ReadonlySet<A>, b: ReadonlySet<A>) => {
  let count = 0
  for (const item of a) if (b.has(item)) count++
  return count
}

/**
 * Each word's senses with the synonyms and antonyms its source listed for a whole part of
 * speech placed on the sense they belong to: the one sharing a Japanese gloss with the other
 * word ("bother" and eat's 心配させる), failing that the one alone in sharing a word in its
 * glosses ("dine", 食事をとる, and eat's 食事をする), or the only sense there is. References
 * that fit no one sense are left out: a link under the wrong meaning misleads.
 */
const placeReferences = (words: ReadonlyArray<Built>) => {
  const byHeadword = new Map<string, Built>()
  for (const word of words) byHeadword.set(word.headword, word)
  for (const word of words) {
    const folded = word.headword.toLowerCase()
    if (!byHeadword.has(folded)) byHeadword.set(folded, word)
  }
  const glossesOf = (headword: string) => {
    const word = byHeadword.get(headword) ?? byHeadword.get(headword.toLowerCase())
    return new Set(word?.senses.flatMap((sense) => [...meanings(sense)]) ?? [])
  }

  return (word: Built): ReadonlyArray<SenseRecord> => {
    if (word.references.length === 0) return word.senses
    const xrefs = word.senses.map((sense) => [...sense.xrefs])
    const antonyms = word.senses.map((sense) => [...sense.antonyms])
    const own = word.senses.map(meanings)
    const ownPairs = own.map(bigrams)
    for (const { from, to, synonyms, antonyms: opposites } of word.references) {
      const place = (other: string, into: Array<Array<string>>, byMeaning: boolean) => {
        let best = to - from === 1 ? from : -1
        if (byMeaning && best === -1) {
          const theirs = glossesOf(other)
          const theirPairs = bigrams(theirs)
          const scores = [...Array(to - from).keys()].map(
            (offset) => 10 * overlap(own[from + offset]!, theirs) + overlap(ownPairs[from + offset]!, theirPairs)
          )
          const top = Math.max(...scores)
          if (top > 0 && scores.filter((score) => score === top).length === 1) best = from + scores.indexOf(top)
        }
        if (best !== -1 && !into[best]!.includes(other)) into[best]!.push(other)
      }
      for (const synonym of synonyms) place(synonym, xrefs, true)
      for (const antonym of opposites) place(antonym, antonyms, false)
    }
    return word.senses.map((sense, index) => ({ ...sense, xrefs: xrefs[index]!, antonyms: antonyms[index]! }))
  }
}

/** Usage notes that make a sense one learners rarely need. */
const LITTLE_USED = new Set(["arch", "obs", "rare", "dated", "hist"])

/**
 * Keeps the consolidated sense order while placing any archaic, obsolete, rare, or dated
 * senses after current ones.
 */
export const commonestFirst = (senses: ReadonlyArray<SenseRecord>): Array<SenseRecord> => {
  const littleUsed = (sense: SenseRecord) => sense.misc.some((tag) => LITTLE_USED.has(tag))
  return senses
    .map((sense, index) => ({ sense, index, little: littleUsed(sense) ? 1 : 0 }))
    .toSorted((a, b) => a.little - b.little || a.index - b.index)
    .map(({ sense }) => sense)
}

const pronoun = (word: Built) => word.senses.some((sense) => sense.pos.includes("pn"))

const FAMILIARITY_COUNTS: Readonly<Record<number, number>> = {
  5: 10_000,
  4: 1_000,
  3: 100,
  2: 10,
  1: 0
}

/**
 * How often a word is used: its own count and its inflections', since "ate" is "eat" being
 * used. When a multi-word idiom ("keep it real", "under the weather", "hang out") or modern
 * slang ("no cap", "rizz", "GOAT") has no count in the single-word subtitle corpus, its
 * consolidated familiarity rating provides a fallback usage weight.
 */
const usage = (word: Built, frequency: ReadonlyMap<string, number>, lowercase: ReadonlyMap<string, Built>) => {
  const twin = lowercase.get(word.headword.toLowerCase())
  const isAcronym = word.senses.some((s) => s.misc.includes("abbr"))
  if (twin !== undefined && twin !== word && !isAcronym && !(pronoun(word) && !pronoun(twin))) return 0
  const forms = new Set([word.headword, ...word.inflections.keys()].map((form) => form.toLowerCase()))
  let count = 0
  for (const form of forms) count += frequency.get(form) ?? 0
  if (count > 0) return count
  return word.familiarity !== undefined ? (FAMILIARITY_COUNTS[word.familiarity] ?? 0) : 0
}

/** Usage folded into a priority on the scale of JMDict's (about 0–150), so ranking treats both alike. */
const priorityOf = (count: number) => (count > 0 ? Math.round(20 * Math.log10(count)) : 0)

const form = (
  text: string,
  kind: "spelling" | "inflection",
  common: boolean,
  tags: ReadonlyArray<string>
): FormRecord => ({
  kind,
  text,
  common,
  tags,
  priorities: [],
  restrictions: [],
  noKanji: false
})

/**
 * Entry records for the consolidated words, most used first. Words already in the database keep
 * their ids, so saved words and enrichment survive a re-import; new words are numbered on.
 */
export const toEntries = (
  words: ReadonlyArray<Built>,
  frequency: ReadonlyMap<string, number>,
  existing: ReadonlyMap<string, number>
): Array<EntryRecord> => {
  const lowercase = new Map(
    words.filter((word) => word.headword === word.headword.toLowerCase()).map((word) => [word.headword, word])
  )
  const ranked = words
    .map((word) => ({ word, count: usage(word, frequency, lowercase) }))
    .sort((a, b) => b.count - a.count || (a.word.headword < b.word.headword ? -1 : 1))
  let next = FIRST_ENGLISH_ID
  for (const id of existing.values()) next = Math.max(next, id)
  next++
  const sensesOf = placeReferences(words)
  let commonSoFar = 0
  return ranked.map(({ word, count }) => {
    const common =
      word.familiarity !== undefined ? word.familiarity >= 4 : count > 0 && commonSoFar < COMMON_WORDS
    if (count > 0) commonSoFar++
    const spellings = [...word.spellings].filter((spelling) => !word.inflections.has(spelling))
    return {
      id: EntryId.make(existing.get(word.headword) ?? next++),
      language: "en" as const,
      headword: word.headword,
      reading: word.ipa ?? "",
      common,
      priority: priorityOf(count),
      forms: [
        form(word.headword, "spelling", common, []),
        ...spellings.map((spelling) => form(spelling, "spelling", false, [])),
        ...[...word.inflections].map(([text, tags]) => form(text, "inflection", false, [...tags]))
      ],
      senses: word.familiarity !== undefined ? [...sensesOf(word)] : commonestFirst(sensesOf(word))
    }
  })
}
