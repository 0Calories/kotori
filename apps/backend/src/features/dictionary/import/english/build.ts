import { EntryId, type FormRecord, type SenseRecord } from "@kotori/contracts"
import { FIRST_ENGLISH_ID, type Source } from "@kotori/db"
import { type EnglishInflection, normalizeGloss, normalizeJapaneseGloss } from "@kotori/language"
import type { ImportEntry } from "../seedFacts.ts"
import type { FormOf, InflectedForm, References, Word } from "./words.ts"

/** How many of the most used words count as common, as JMDict's markers make about a tenth of its words common. */
const COMMON_WORDS = 10_000

/** Baseline usage count for curated idioms/slang that don't appear in `en_50k.txt` unigrams. */
const CURATED_FLOOR = 1_000

/**
 * Baseline usage count for a phrase at each frequency rating, since the unigram counts can't
 * see phrases: 5 ranks with everyday words, 3 with words in ordinary use, 1 with words that are
 * only just understood. Curated entries carry their rating; the rest get theirs from
 * `data/english/frequency.json` (`kotori frequency`).
 */
const FREQUENCY_FLOOR: Readonly<Record<number, number>> = { 1: 300, 2: 600, 3: CURATED_FLOOR, 4: 3_000, 5: 10_000 }

export type Tier = "curated" | "wiktionary" | "jmdict"

/** The seed source each tier's senses come from, as entries, labels and usage patterns name it. */
const SOURCE: Readonly<Record<Tier, Source>> = {
  curated: "enwiktionary",
  wiktionary: "jawiktionary",
  jmdict: "jmdict"
}

/** A word as the dictionary will hold it, with where it came from. */
interface Built {
  readonly headword: string
  readonly tier: Tier
  ipa: string | null
  readonly spellings: Set<string>
  readonly inflections: Map<string, Set<EnglishInflection>>
  readonly senses: Word["senses"]
  readonly references: ReadonlyArray<References>
  readonly mayBeName: boolean
  readonly frequency?: number | undefined
  readonly source: Source
}

const built = (word: Word, tier: Tier): Built => ({
  headword: word.headword,
  tier,
  ipa: word.ipa,
  spellings: new Set(word.spellings.filter((spelling) => spelling !== word.headword)),
  inflections: new Map(word.inflections.map((form) => [form.text, new Set(form.tags)])),
  senses: word.senses,
  references: word.references ?? [],
  mayBeName: word.mayBeName ?? false,
  frequency: word.frequency,
  source: word.source ?? SOURCE[tier]
})

const addInflection = (word: Built, form: InflectedForm) => {
  if (form.text === word.headword) return
  const tags = word.inflections.get(form.text) ?? new Set<EnglishInflection>()
  for (const tag of form.tags) tags.add(tag)
  word.inflections.set(form.text, tags)
}

export interface Sources {
  /** Curated English Wiktionary entries (`enwiktionary-ja.jsonl`), consolidated and learner-ordered. */
  readonly curated?: { readonly words: ReadonlyArray<Word>; readonly formsOf?: ReadonlyArray<FormOf> } | undefined
  /** Japanese Wiktionary next: it has parts of speech, IPA and inflections. */
  readonly wiktionary: { readonly words: ReadonlyArray<Word>; readonly formsOf: ReadonlyArray<FormOf> }
  /** Built knowing the other sources, so it only has words they lack, plus variant forms of existing idioms. */
  readonly jmdict: { readonly words: ReadonlyArray<Word>; readonly formsOf?: ReadonlyArray<FormOf> | undefined }
  readonly subtitles?: ReadonlyMap<string, number> | undefined
}

/**
 * One dictionary from the sources: each headword from the first source that has it,
 * with the forms the others point at it. Case tells words apart ("Polish", "polish").
 */
export const mergeSources = (sources: Sources): Array<Built> => {
  const words = new Map<string, Built>()
  const add = (word: Word, tier: Tier) => {
    const existing = words.get(word.headword)
    if (existing === undefined) {
      words.set(word.headword, built(word, tier))
      return
    }
    existing.ipa ??= word.ipa
    for (const spelling of word.spellings) {
      if (spelling !== existing.headword) existing.spellings.add(spelling)
    }
    for (const form of word.inflections) addInflection(existing, form)
  }
  for (const word of sources.curated?.words ?? []) add(word, "curated")
  for (const word of sources.wiktionary.words) add(word, "wiktionary")
  for (const word of sources.jmdict.words) add(word, "jmdict")

  const folded = new Map<string, Built>()
  for (const word of words.values())
    if (!folded.has(word.headword.toLowerCase())) folded.set(word.headword.toLowerCase(), word)
  const formsOf = [
    ...(sources.curated?.formsOf ?? []),
    ...sources.wiktionary.formsOf,
    ...(sources.jmdict.formsOf ?? [])
  ]
  for (const form of formsOf) {
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

  return (word: Built): Built["senses"] => {
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
 * The Japanese words a gloss may name, for matching it to JMDict's spellings: the gloss as
 * looked up ("～を食べる" -> "食べる"), and without a な, の, に, と, だ or する ending, as
 * JMDict writes na-adjectives, adverbs and suru verbs bare ("利口な", "勉強する").
 */
const namedWords = (gloss: string) => {
  const word = normalizeJapaneseGloss(gloss)
  const bare = word.replace(/(?:をする|する|な|の|に|と|だ)$/u, "")
  return bare.length > 0 && bare !== word ? [word, bare] : [word]
}

/**
 * Senses commonest first, as JMDict lists them. Wiktionary often lists the oldest or most
 * literal senses first ("kid": a young goat; "coffee": the coffee plant; "smart": to sting),
 * and no common Japanese word translates those. So a sense is attested when it names, among
 * its glosses, a common Japanese word that JMDict translates with the English word
 * (`backTranslations`), weighted by that word's best weight. The first attested sense leads;
 * the other attested senses follow by weight ("fall": 秋 rises from twelfth to sixth); the rest
 * keep Wiktionary's order after them; and archaic, obsolete, rare and dated senses go last
 * ("sad": 満足した, obsolete). A sense's weight is its heaviest word's, not their sum: summed,
 * senses listing more synonyms won ("cool" led with 冷淡な, "kid" with からかう).
 */
export const commonestFirst = <S extends SenseRecord>(
  senses: ReadonlyArray<S>,
  attested: ReadonlyMap<string, number> = new Map()
): Array<S> => {
  const littleUsed = (sense: SenseRecord) => sense.misc.some((tag) => LITTLE_USED.has(tag))
  const weight = (sense: SenseRecord) =>
    Math.max(0, ...sense.glosses.flatMap((gloss) => namedWords(gloss.text).map((word) => attested.get(word) ?? 0)))
  const ranked = senses.map((sense, index) => ({ sense, index, weight: weight(sense), little: littleUsed(sense) }))
  const lead = ranked.find((sense) => !sense.little && sense.weight > 0)
  const rank = (sense: (typeof ranked)[number]) => (sense.little ? 3 : sense === lead ? 0 : sense.weight > 0 ? 1 : 2)
  return ranked
    .toSorted((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? b.weight - a.weight : 0) || a.index - b.index)
    .map(({ sense }) => sense)
}

const pronoun = (word: Built) => word.senses.some((sense) => sense.pos.includes("pn"))

const attestedTranslations = (
  headword: string,
  translations: ReadonlyMap<string, ReadonlyMap<string, number>>
): ReadonlyMap<string, number> | undefined =>
  translations.get(headword.toLowerCase()) ?? translations.get(normalizeGloss(headword))

/**
 * How often a word is used: its own count and its inflections', since "ate" is "eat" being
 * used. The counts are of lowercased text, so where a capitalised word has a lowercase twin
 * the count is the twin's: "a", not the letter "A"; "may", not the month. Only the pronoun
 * "I" outranks its twin, the letter "i". A rated word (curated, or in the frequency file)
 * counts at least its rating's floor, unless the rating says it is little used and the
 * subtitles counted it anyway.
 */
const usage = (
  word: Built,
  subtitles: ReadonlyMap<string, number>,
  lowercase: ReadonlyMap<string, Built>,
  translations: ReadonlyMap<string, ReadonlyMap<string, number>>,
  ratings: ReadonlyMap<string, number>
) => {
  const twin = lowercase.get(word.headword.toLowerCase())
  if (twin !== undefined && twin !== word && !(pronoun(word) && !pronoun(twin)))
    return { count: 0, rawCount: 0, score: undefined }
  const forms = new Set([word.headword, ...word.inflections.keys()].map((form) => form.toLowerCase()))
  let rawCount = 0
  for (const form of forms) rawCount += subtitles.get(form) ?? 0
  const score = word.frequency ?? ratings.get(word.headword.toLowerCase())
  if (score !== undefined || word.tier === "curated") {
    const floor = FREQUENCY_FLOOR[score ?? 3] ?? CURATED_FLOOR
    const count = rawCount === 0 || (score ?? 3) >= 3 ? Math.max(rawCount, floor) : rawCount
    return { count, rawCount, score }
  }
  if (rawCount === 0 && word.headword.includes(" ")) {
    const attested = attestedTranslations(word.headword, translations)
    const bestWeight = attested !== undefined ? Math.max(0, ...attested.values()) : 0
    const count = bestWeight >= 45 ? 2_500 : bestWeight >= 30 ? 1_000 : bestWeight > 0 ? 300 : 0
    return { count, rawCount, score }
  }
  return { count: rawCount, rawCount, score }
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
 * `ratings` are 1–5 frequency ratings by lowercased headword for words whose source has none.
 */
export const toEntries = (
  words: ReadonlyArray<Built>,
  subtitles: ReadonlyMap<string, number>,
  existing: ReadonlyMap<string, number>,
  translations: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(),
  ratings: ReadonlyMap<string, number> = new Map()
): Array<ImportEntry & { readonly tier: Tier }> => {
  const lowercase = new Map(
    words.filter((word) => word.headword === word.headword.toLowerCase()).map((word) => [word.headword, word])
  )
  const ranked = words
    .map((word) => ({ word, ...usage(word, subtitles, lowercase, translations, ratings) }))
    .sort((a, b) => b.count - a.count || (a.word.headword < b.word.headword ? -1 : 1))
  let next = FIRST_ENGLISH_ID
  for (const id of existing.values()) next = Math.max(next, id)
  next++
  const sensesOf = placeReferences(words)
  let commonSoFar = 0
  return ranked.map(({ word, count, rawCount, score }) => {
    const common = !word.mayBeName && (rawCount > 0 || count >= 2_500) && count > 0 && commonSoFar < COMMON_WORDS
    if (common) commonSoFar++
    const spellings = [...word.spellings].filter((spelling) => !word.inflections.has(spelling))
    const placedSenses = sensesOf(word)
    return {
      id: EntryId.make(existing.get(word.headword) ?? next++),
      language: "en" as const,
      tier: word.tier,
      source: word.source,
      headword: word.headword,
      reading: word.ipa ?? "",
      common,
      priority: priorityOf(count),
      // Everyday is the dictionary's own common mark (the most used words); the spoken count is the
      // subtitles' own, before any rating floor, so a phrase they can't see has none.
      frequency: { everyday: common, spokenCount: rawCount > 0 ? rawCount : null, score: score ?? null },
      forms: [
        form(word.headword, "spelling", common, []),
        ...spellings.map((spelling) => form(spelling, "spelling", false, [])),
        ...[...word.inflections].map(([text, tags]) => form(text, "inflection", false, [...tags]))
      ],
      // Curated entries already have senses consolidated and ordered for learners;
      // open-source entries use JMdict back-translations to promote attested everyday senses.
      senses:
        word.tier === "curated"
          ? [...placedSenses]
          : commonestFirst(
              placedSenses,
              word.headword === word.headword.toLowerCase()
                ? attestedTranslations(word.headword, translations)
                : undefined
            )
    }
  })
}
