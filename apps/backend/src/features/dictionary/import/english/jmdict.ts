import type { EntryRecord } from "@kotori/contracts"
import { type EnglishInflection, isEnglishFunctionWord, normalizeGloss, romanize, uninflect } from "@kotori/language"
import { addRedirect, addTo, emptySense, type FormOf, isEnglish, type Word } from "./words.ts"

/**
 * English words the other sources lack, read backwards from JMDict: "selfie" is a gloss of
 * 自撮り, "hang out" of 遊ぶ, たむろする and 入り浸る. Synonymous Japanese words sharing a
 * part of speech are grouped into shared senses, most likely first.
 *
 * JMDict's glosses include descriptions as well as words ("clear autumnal weather"), so of
 * glosses of several words only attested ones are taken: phrases Wiktionary lists, and phrasal
 * verbs. Every single word is taken, as a word or as a form of the word it inflects; how often
 * the subtitles count it only ranks it.
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

/**
 * The words a gloss may wrap an attested phrase in without naming anything else: "a stone's
 * throw away (from)" and "within a stone's throw (of)" both name "stone's throw". Particles,
 * articles, a few adverbs of degree, forms of "be" and "get", and the dictionary's placeholders.
 */
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

/** The most frame words around a phrase; more and the gloss is describing something else. */
const MAX_FRAME = 3

/** Words of a phrase that are its own, not placeholders, pronouns, articles or prepositions. */
const contentWords = (words: ReadonlyArray<string>) => words.filter((word) => !isEnglishFunctionWord(word)).length

/**
 * The longest attested phrase inside a gloss, framed only by `FRAME_WORDS`: "stone's throw" in
 * "within a stone's throw", with the gloss as a variant of it. The phrase needs two words of its
 * own, or fragments the phrase index also lists ("of a", "on the") would claim every gloss
 * holding them. Null when no such phrase is there.
 */
const framedPhrase = (words: ReadonlyArray<string>, attested: (phrase: string) => boolean): string | null => {
  for (let length = words.length - 1; length >= 2; length--) {
    for (let start = 0; start + length <= words.length; start++) {
      const inside = words.slice(start, start + length)
      const frame = [...words.slice(0, start), ...words.slice(start + length)]
      if (frame.length > MAX_FRAME || !frame.every((word) => FRAME_WORDS.has(word))) continue
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

/**
 * The word a gloss with capitals in it names, as written, when it is one word: "Nordic",
 * "Ramadan", "Viennese (of Vienna)", "NHK", "iPod". Null for glosses of several words, which
 * are sentences and titles ("Good morning!", "New Year's Eve") rather than words.
 */
const properWord = (text: string): string | null => {
  const word = text.replace(/\([^)]*\)/g, " ").trim()
  return /^[A-Za-z][A-Za-z0-9'-]*$/.test(word) && /[A-Z]/.test(word) ? word : null
}

/** Explanations, literal renderings and trademarks aren't English words. */
const SKIPPED_TYPES = new Set(["expl", "lit", "tm"])

/** The English word class one JMDict part of speech names: "v5k" a verb, "vs" (a noun taking する) a noun… */
const wordClass = (code: string): "v" | "n" | "adj" | "adv" | null =>
  /^v(?!s$)/.test(code)
    ? "v"
    : code.startsWith("n") || code === "vs"
      ? "n"
      : code.startsWith("adj")
        ? "adj"
        : code.startsWith("adv")
          ? "adv"
          : null

/** The word classes a JMDict sense's parts of speech name. */
const wordClasses = (pos: ReadonlyArray<string>) => {
  const classes = new Set(pos.map(wordClass))
  return { noun: classes.has("n"), verb: classes.has("v"), adjective: classes.has("adj"), adverb: classes.has("adv") }
}

/** JMDict parts of speech → the English codes a Japanese word lends the English one. */
const partOfSpeech = (codes: ReadonlyArray<string>): Array<string> => {
  for (const code of codes) {
    const english = wordClass(code)
    if (english !== null) return [english]
    if (["int", "exp", "pn", "conj", "num", "pref", "suf"].includes(code)) return [code]
  }
  return []
}

/** The same ranking search uses: common words, early senses and first glosses go first. */
const SENSE_BONUS = [40, 25, 15, 10, 5]
/** JMDict's tags for names: a company, product, work, character, surname, place… */
const NAME_TAGS: ReadonlySet<string> = new Set([
  "char",
  "company",
  "creat",
  "dei",
  "doc",
  "ev",
  "fem",
  "fict",
  "given",
  "group",
  "leg",
  "male",
  "masc",
  "myth",
  "obj",
  "organization",
  "oth",
  "person",
  "place",
  "product",
  "relig",
  "serv",
  "ship",
  "station",
  "surname",
  "unclass",
  "work"
] as const)

const RARE = new Set(["arch", "obs", "obsc", "rare", "hist", "vulg", "X", "derog"])

interface Candidate {
  readonly japanese: string
  /** Whether JMDict marks the Japanese word common. */
  readonly common: boolean
  readonly pos: ReadonlyArray<string>
  readonly score: number
  /** Whether JMDict tags the sense glossing it as a name's. */
  readonly name: boolean
}

/** Back-translations are read from a Japanese word's leading senses and glosses, where JMDict puts the common ones. */
const BACK_SENSES = 3
const BACK_GLOSSES = 4

export interface KnownEnglish {
  /** Lowercased headwords, spellings and inflections of the words already in the dictionary. */
  readonly words: ReadonlySet<string>
  /** Lowercased verbs, for recognising phrasal verbs. */
  readonly verbs: ReadonlySet<string>
  /** Lowercased adjectives and adverbs, the words with comparatives and superlatives ("bigger", "faster"). */
  readonly gradable: ReadonlySet<string>
  /** Headwords and spellings of the words already in, as written: "Polish" and "polish" are two words. */
  readonly spelled: ReadonlySet<string>
  /** Lowercased phrases Wiktionary lists under a word. */
  readonly phrases: ReadonlySet<string>
  /** Variant idiom phrasings mapped to their canonical headword ("skate on thin ice" -> "on thin ice"). */
  readonly redirects?: ReadonlyMap<string, string> | undefined
}

/**
 * The headword a gloss names, and the gloss as a way of writing it when the two differ. With
 * `inflection`, the gloss is that inflection of the headword ("sins" of "sin"), not a spelling.
 */
interface Resolved {
  readonly headword: string
  readonly variant?: string
  readonly inflection?: ReadonlyArray<EnglishInflection>
}

/**
 * Whether the regular rules could make `word` from `base`, as `uninflect` guesses more widely:
 * "-es" follows only s, x, z, ch, sh and o ("tines" is not "tin" + "es", nor "Hades" "had"), and
 * a base of two letters is an irregular word the sources list ("woes" is not "wo" + "es").
 */
const isRegularBase = (word: string, base: string) =>
  base.length > 2 && (word !== `${base}es` || /(?:s|x|z|ch|sh|o)$/.test(base))

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

  /**
   * The word already in that a single word inflects, read as the sense glossing it uses it:
   * "sins" of "sin" (plural, for a noun), "bigger" of "big". Only adjectives and adverbs compare,
   * and only as adjectives or adverbs, so "sinner", "singer" and "outsider" are words of their
   * own, and a noun or adjective in -ing or -ed ("building", "interesting") is one too. Null when
   * it inflects no word in.
   */
  const inflectionOf = (
    written: string,
    pos: ReadonlyArray<string>
  ): { readonly base: string; readonly tags: ReadonlyArray<EnglishInflection> } | null => {
    // Names and acronyms are words of their own: "Andes" is not the plural of "and", nor "SOS" of "so".
    if (written !== written.toLowerCase()) return null
    const { noun, verb, adjective, adverb } = wordClasses(pos)
    // Only adjectives and adverbs compare: "outsider" and "defer" are words of their own.
    const compares = adjective || adverb
    for (const { base, tags } of uninflect(written)) {
      if (!known.spelled.has(base) || !isRegularBase(written, base)) continue
      const kept = tags.filter((tag) => {
        switch (tag) {
          case "comparative":
          case "superlative":
            return compares && known.gradable.has(base)
          case "past":
          case "past-participle":
          case "present-participle":
            return !noun && !adjective
          case "plural":
            return noun || !verb
          case "third-person":
            return verb || !noun
        }
      })
      if (kept.length > 0) return { base, tags: kept }
    }
    return null
  }

  /**
   * A single word: a new one, whether or not the subtitles counted it (the counts only rank), or
   * an inflection of a word already in, which becomes a form of that word.
   */
  const resolveWord = (written: string, pos: ReadonlyArray<string>): Resolved => {
    const inflection = inflectionOf(written, pos)
    return inflection === null
      ? { headword: written }
      : { headword: inflection.base, variant: written, inflection: inflection.tags }
  }

  /**
   * A capitalised word keeps its case ("Nordic"), as Wiktionary's do, and is its own word beside
   * a lowercase twin: "Polish", the nationality, is not "polish", the verb, and "US" is not "us".
   * One already in as written is left to its source.
   */
  const resolveProper = (word: string, pos: ReadonlyArray<string>): Resolved | null =>
    known.spelled.has(word) ? null : resolveWord(word, pos)

  /**
   * Whether a headword is in already: a single word as written ("mop" is not in because the
   * acronym "MOP" is), a phrase by its lowercased text, as phrases are kept.
   */
  const isKnown = (headword: string) =>
    headword.includes(" ") ? known.words.has(headword) : known.spelled.has(headword)

  const resolveHeadword = (term: string, pos: ReadonlyArray<string>): Resolved | null => {
    const words = term.split(" ")
    if (words.length === 1) return known.spelled.has(term) ? { headword: term } : resolveWord(term, pos)
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
    // "a stone's throw away (from)", "within a stone's throw (of)": a phrase with a frame around
    // it, which becomes a way the phrase is written.
    const framed = framedPhrase(words, (phrase) => phrases.has(phrase) || redirects.has(phrase))
    if (framed !== null) return { headword: redirects.get(framed) ?? framed, variant: term }
    return null
  }

  const candidates = new Map<string, Array<Candidate>>()
  const variants = new Map<string, Set<string>>()
  // Inflections of words already in that JMDict glosses: "sins" of "sin".
  const inflections = new Map<string, Map<string, Set<EnglishInflection>>>()
  // Per English word already in the dictionary: the spellings of the common Japanese words that
  // JMDict translates with it, each with its best weight as a candidate, as evidence of which
  // of the English word's senses are in common use.
  const translations = new Map<string, Map<string, number>>()

  const add = (entry: EntryRecord) => {
    const romaji = romanize(entry.reading)
    entry.senses.forEach((sense, senseIndex) => {
      sense.glosses.forEach((gloss, position) => {
        if (gloss.type !== null && SKIPPED_TYPES.has(gloss.type)) return
        // Lowercase glosses are words, and so is a capitalised one of a single word.
        const proper = properWord(gloss.text)
        if (proper === null && !/^[a-z]/.test(gloss.text)) return
        const term = normalizeGloss(gloss.text)
        if (term.length < 2 || !isEnglish(term) || term === romaji) return
        const resolved = proper === null ? resolveHeadword(term, sense.pos) : resolveProper(proper, sense.pos)
        if (resolved === null) return
        const { headword, variant, inflection } = resolved
        if (inflection !== undefined && variant !== undefined) {
          const forms = inflections.get(headword) ?? new Map<string, Set<EnglishInflection>>()
          inflections.set(headword, forms)
          addTo(forms, variant, ...inflection)
          return
        }
        if (variant !== undefined && variant !== headword && !known.words.has(variant)) {
          addTo(variants, headword, variant)
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
        if (isKnown(headword)) {
          if (isIdiomOrCommon) recordTranslation()
          return
        }
        if (headword.includes(" ") && isIdiomOrCommon) recordTranslation()
        const list = candidates.get(headword) ?? []
        candidates.set(headword, list)
        list.push({
          japanese: entry.headword,
          common: entry.common,
          pos: partOfSpeech(sense.pos),
          score,
          name: sense.misc.some((tag) => NAME_TAGS.has(tag))
        })
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
        // Only ever glossed on name senses, it is a name. Otherwise a common Japanese word for it
        // vouches for the count, and names are rarely hyphenated ("ex-wife") or multi-word
        // phrases; failing both, the count may be a name's: 韓国海苔 is glossed "kim".
        naming: list.every((candidate) => candidate.name)
          ? "name"
          : !headword.includes(" ") && !headword.includes("-") && !list.some((candidate) => candidate.common)
            ? "possible-name"
            : "word"
      }
    })

  const formsOf = (): Array<FormOf> => [
    ...[...variants].flatMap(([base, set]) => [...set].map((text): FormOf => ({ text, base, tags: [] }))),
    ...[...inflections].flatMap(([base, forms]) =>
      [...forms].map(([text, tags]): FormOf => ({ text, base, tags: [...tags] }))
    )
  ]

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
