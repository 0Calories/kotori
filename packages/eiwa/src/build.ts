import { type EntryRecord, type FormRecord, normalizeJapaneseGloss, type SenseRecord } from "@kotori/db"
import type { Inflection } from "./tags.ts"
import type { FormOf, InflectedForm, References, Word } from "./words.ts"

/** English entries are numbered from here, well above JMDict's sequence numbers (at most 9,999,999). */
const FIRST_ENGLISH_ID = 100_000_000

/** How many of the most used words count as common, as JMDict's markers make about a tenth of its words common. */
const COMMON_WORDS = 10_000

export type Source = "wiktionary" | "ejdict" | "jmdict"

/** A word as the dictionary will hold it, with where it came from. */
interface Built {
  readonly headword: string
  readonly source: Source
  ipa: string | null
  readonly spellings: Set<string>
  readonly inflections: Map<string, Set<Inflection>>
  readonly senses: Word["senses"]
  readonly references: ReadonlyArray<References>
  readonly mayBeName: boolean
}

const built = (word: Word, source: Source): Built => ({
  headword: word.headword,
  source,
  ipa: word.ipa,
  spellings: new Set(word.spellings.filter((spelling) => spelling !== word.headword)),
  inflections: new Map(word.inflections.map((form) => [form.text, new Set(form.tags)])),
  senses: word.senses,
  references: word.references ?? [],
  mayBeName: word.mayBeName ?? false
})

const addInflection = (word: Built, form: InflectedForm) => {
  if (form.text === word.headword) return
  const tags = word.inflections.get(form.text) ?? new Set<Inflection>()
  for (const tag of form.tags) tags.add(tag)
  word.inflections.set(form.text, tags)
}

export interface Sources {
  /** Japanese Wiktionary first: it has parts of speech, IPA and inflections. */
  readonly wiktionary: { readonly words: ReadonlyArray<Word>; readonly formsOf: ReadonlyArray<FormOf> }
  readonly ejdict: { readonly words: ReadonlyArray<Word>; readonly formsOf: ReadonlyArray<FormOf> }
  /** Built knowing the other two, so it only has words they lack. */
  readonly jmdict: ReadonlyArray<Word>
  readonly frequency: ReadonlyMap<string, number>
}

/**
 * One dictionary from the three sources: each headword from the first source that has
 * it, with the forms the others point at it. Case tells words apart ("Polish", "polish").
 */
export const mergeSources = (sources: Sources): Array<Built> => {
  const words = new Map<string, Built>()
  const add = (word: Word, source: Source) => {
    if (!words.has(word.headword)) words.set(word.headword, built(word, source))
  }
  for (const word of sources.wiktionary.words) add(word, "wiktionary")
  for (const word of sources.ejdict.words) add(word, "ejdict")
  for (const word of sources.jmdict) add(word, "jmdict")

  const folded = new Map<string, Built>()
  for (const word of words.values())
    if (!folded.has(word.headword.toLowerCase())) folded.set(word.headword.toLowerCase(), word)
  for (const form of [...sources.wiktionary.formsOf, ...sources.ejdict.formsOf]) {
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
      // Opposites rarely share a gloss, so only a part of speech with one sense places them.
      for (const antonym of opposites) place(antonym, antonyms, false)
    }
    return word.senses.map((sense, index) => ({ ...sense, xrefs: xrefs[index]!, antonyms: antonyms[index]! }))
  }
}

/** Usage notes that make a sense one learners rarely need. */
const LITTLE_USED = new Set(["arch", "obs", "rare", "dated", "hist"])

/**
 * Senses in the order JMDict gives them, commonest first: Wiktionary often lists the oldest
 * first ("sad": 満足した, obsolete), so archaic, obsolete, rare and dated senses go last.
 */
const commonestFirst = (senses: ReadonlyArray<SenseRecord>) => {
  const littleUsed = (sense: SenseRecord) => sense.misc.some((tag) => LITTLE_USED.has(tag))
  return [...senses.filter((sense) => !littleUsed(sense)), ...senses.filter(littleUsed)]
}

const pronoun = (word: Built) => word.senses.some((sense) => sense.pos.includes("pn"))

/**
 * How often a word is used: its own count and its inflections', since "ate" is "eat" being
 * used. The counts are of lowercased text, so where a capitalised word has a lowercase twin
 * the count is the twin's: "a", not the letter "A"; "may", not the month. Only the pronoun
 * "I" outranks its twin, the letter "i".
 */
const usage = (word: Built, frequency: ReadonlyMap<string, number>, lowercase: ReadonlyMap<string, Built>) => {
  const twin = lowercase.get(word.headword.toLowerCase())
  if (twin !== undefined && twin !== word && !(pronoun(word) && !pronoun(twin))) return 0
  const forms = new Set([word.headword, ...word.inflections.keys()].map((form) => form.toLowerCase()))
  let count = 0
  for (const form of forms) count += frequency.get(form) ?? 0
  return count
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
 * Entry records for the merged words, most used first. Words already in the database keep
 * their ids, so saved words and enrichment survive a re-import; new words are numbered on.
 */
export const toEntries = (
  words: ReadonlyArray<Built>,
  frequency: ReadonlyMap<string, number>,
  existing: ReadonlyMap<string, number>
): Array<EntryRecord & { readonly source: Source }> => {
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
    const common = !word.mayBeName && count > 0 && commonSoFar < COMMON_WORDS
    if (common) commonSoFar++
    const spellings = [...word.spellings].filter((spelling) => !word.inflections.has(spelling))
    return {
      id: existing.get(word.headword) ?? next++,
      language: "en" as const,
      source: word.source,
      headword: word.headword,
      reading: word.ipa ?? "",
      common,
      priority: priorityOf(count),
      forms: [
        form(word.headword, "spelling", common, []),
        ...spellings.map((spelling) => form(spelling, "spelling", false, [])),
        ...[...word.inflections].map(([text, tags]) => form(text, "inflection", false, [...tags]))
      ],
      senses: commonestFirst(sensesOf(word))
    }
  })
}
