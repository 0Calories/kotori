import {
  EntryId,
  type EntryRecord,
  type EntrySummary,
  type Label,
  type Language,
  type SearchMatch,
  type SearchResult
} from "@kotori/contracts"
import {
  deinflect,
  englishPhraseVariants,
  englishSearchTerms,
  hasJapanese,
  katakanaToHiragana,
  keepBest as keepBestBy,
  matchesPartOfSpeech,
  normalizeEnglishPhrase,
  normalizeGloss,
  normalizeJapaneseGloss,
  relaxedEnglishSearchTerms,
  romajiToKana,
  romanize,
  toFullwidth,
  uninflect
} from "@kotori/language"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { entryClips } from "../audio/index.ts"
import type { FormMatch, GlossMatch } from "./queries.ts"
import {
  entryRanks,
  findFormPrefix,
  findForms,
  findGlossesExact,
  findJapaneseGlosses,
  getEntries,
  searchForms,
  searchFormsFuzzy,
  searchGlosses,
  searchGlossesFuzzy,
  searchJapaneseGlosses
} from "./queries.ts"
import { audioUrl, firstGlosses, unique } from "./shared.ts"
import { senseLabels } from "./similar.ts"
import { labelsBySense } from "./usage.ts"

// Search and ranking: the words of either dictionary that answer a query, best first, and the
// summaries search results and Ask Kotori's links show of them.

interface Hit {
  readonly entryId: EntryId
  readonly score: number
  readonly inflection: ReadonlyArray<string>
  /**
   * Whether the entry answers the query rather than resembling it: the word as written or
   * inflected, or a gloss with every word of the query; not a prefix, a typo's neighbour or a
   * phrase with a word left out. See `SearchMatch`.
   */
  readonly strong: boolean
}

/** How well a list of hits answers the query, from the best hit's kind. */
const matchOf = (hits: ReadonlyArray<Hit>): SearchMatch =>
  hits.length === 0 ? "none" : hits.some((hit) => hit.strong) ? "exact" : "weak"

const keepBest = (hits: Iterable<Hit>) => keepBestBy(hits, (hit) => hit.entryId)

const SENSE_BONUS = [40, 25, 15, 10, 5]

/** Usage tags that make a word a less likely answer to a plain query. */
const TAG_PENALTY: Record<string, number> = {
  arch: 30,
  obs: 30,
  obsc: 30,
  rare: 25,
  hist: 10,
  vulg: 15,
  X: 15,
  derog: 15,
  sl: 8,
  "net-sl": 8,
  "m-sl": 8,
  male: 6,
  fem: 6,
  col: 4,
  hon: 6,
  hum: 6,
  form: 6,
  poet: 10
}

const tagPenalty = (misc: ReadonlyArray<string>) => misc.reduce((sum, tag) => sum + (TAG_PENALTY[tag] ?? 0), 0)

/**
 * The searches an English query falls back on when the searches for all its words found fewer than
 * three entries: the phrase with one word left out (`relaxedEnglishSearchTerms`), then, only if
 * still nothing, trigram similarity for typos. Japanese text never gets here, and fallback hits
 * never outrank the word a romaji query spells (see `englishGlossHits`, `searchEnglish`).
 */
const englishFallback = <Relaxed, Fuzzy>(
  query: string,
  found: number,
  search: {
    readonly relaxed: (terms: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Relaxed>>
    readonly fuzzy: () => Effect.Effect<ReadonlyArray<Fuzzy>>
  }
) =>
  Effect.gen(function* () {
    const terms = found < 3 ? relaxedEnglishSearchTerms(query) : []
    const relaxed = terms.length === 0 ? [] : yield* search.relaxed(terms)
    const fuzzy = found === 0 && relaxed.length === 0 ? yield* search.fuzzy() : []
    return { relaxed, fuzzy }
  })

/**
 * Up to 10 points for how close a relaxed match's words sit, from its full-text rank (negated
 * `ts_rank_cd`, 0.1 for adjacent words): "thin ice" in "skate on thin ice" scores 10, three words
 * apart 3. With one word of the phrase missing, order is most of what's left to go on.
 */
const proximity = (rank: number) => Math.min(10, Math.round(-100 * rank))

/** How well a gloss answers a query in the glosses' language, normalised as that language is. */
const glossScore = (
  match: GlossMatch,
  isExact: boolean,
  norm: string,
  normalize: (text: string) => string,
  rank: { readonly common: boolean; readonly priority: number } | undefined
) =>
  (isExact ? 100 : 30) +
  (!isExact && normalize(match.text).startsWith(norm) ? 15 : 0) +
  (SENSE_BONUS[match.sense] ?? 0) -
  3 * match.position -
  4 * Math.min(match.glossCount - 1, 5) -
  tagPenalty(match.misc) +
  Math.min(10, -match.rank) +
  (rank?.common ? 30 : 0) +
  (rank?.priority ?? 0) / 5

/** A word's own form, written as searched, scores a little above the same form in another case or entry. */
const formScore = (
  base: number,
  exactCase: boolean,
  rank: { readonly common: boolean; readonly priority: number } | undefined
) => base + (exactCase ? 20 : 0) + (rank?.common ? 50 : 0) + (rank?.priority ?? 0) / 10

/** "EAT", "IT", "STARTed": capitals in a row, so a word apart from the lowercase one spelled the same. */
const isAcronym = (text: string) => /[A-Z]{2}/.test(text)

/** JMDict's explanations, literal renderings and trademarks aren't English words to look up. */
const BRIDGE_SKIPS = new Set(["expl", "lit", "tm"])
/** The words whose glosses lead to the other dictionary's words, and how many of their senses and glosses. */
const BRIDGE_WORDS = 5
const BRIDGE_SENSES = 2
const BRIDGE_GLOSSES = 4
/** Japanese glosses longer than this explain rather than translate; no word inside them is looked for. */
const INSIDE_GLOSS_MAX = 20
/** A word inside a gloss is 2 to this many characters: no particle, no phrase. */
const INSIDE_WORD_MAX = 10
/** How far a gloss in another spelling of the Japanese word the query is (禿 for ハゲ) ranks below one as typed. */
const SPELLING_PENALTY = 10
/** How far a word inside a gloss ranks below one the whole gloss names. */
const INSIDE_PENALTY = 30

/** A word the query is, whose glosses name words in the other dictionary. */
interface BridgeSource {
  readonly record: EntryRecord
  /** Whether the query is this word as written or listed, rather than a guess at its base form. */
  readonly exact: boolean
}

/** Every stretch of a gloss that could be a word inside it, longest first, left to right. */
const stretches = (gloss: string) => {
  const found: Array<string> = []
  for (let length = Math.min(gloss.length - 1, INSIDE_WORD_MAX); length >= 2; length--) {
    for (let start = 0; start + length <= gloss.length; start++) found.push(gloss.slice(start, start + length))
  }
  return found
}

/** The word's labels, those every sense carries (`senseLabels`), from its labels by sense. */
const wordLabels = (entry: EntryRecord, bySense: ReadonlyMap<number, ReadonlyArray<Label>> | undefined) =>
  senseLabels(entry.senses.map((_, index) => bySense?.get(index) ?? [])).word

/**
 * Which of a guessed "-s" form's meanings applies: a noun's plural or a verb's third person.
 * An unmarked sense is most often a noun's.
 */
const guessedInflection = (tags: ReadonlyArray<string>, entry: EntryRecord | undefined) => {
  if (!(tags.includes("plural") && tags.includes("third-person"))) return tags
  const senses = entry?.senses ?? []
  if (senses.some((sense) => sense.pos.includes("n") || sense.pos.length === 0)) return ["plural"]
  return senses.some((sense) => sense.pos.includes("v")) ? ["third-person"] : []
}

/** Searching a dictionary, and summaries and lookups of its words, on `db`. */
export const makeSearch = (db: DatabaseShape) => {
  // ---------------------------------------------------------------------
  // Search: Japanese words
  // ---------------------------------------------------------------------

  const japaneseHits = Effect.fnUntraced(function* (query: string) {
    const full = toFullwidth(query)
    const variants = unique([query, full, katakanaToHiragana(query), katakanaToHiragana(full)])
    const candidates = variants.flatMap(deinflect)
    const matches = yield* findForms(db, unique(candidates.map((candidate) => candidate.term)), "ja", "listed")
    const entries = new Map((yield* getEntries(db, unique(matches.map((m) => m.entryId)))).map((e) => [e.id, e]))

    const exact = matches.flatMap((match): Array<Hit> => {
      const entry = entries.get(match.entryId)
      if (entry === undefined) return []
      const pos = entry.senses.flatMap((sense) => sense.pos)
      return candidates
        .filter((candidate) => candidate.term === match.text && matchesPartOfSpeech(candidate.type, pos))
        .map((candidate) => ({
          entryId: entry.id,
          score:
            (candidate.reasons.length === 0 ? 1000 : 800 - 10 * candidate.reasons.length) +
            (match.text === entry.headword ? 20 : 0) +
            (entry.common ? 50 : 0) +
            entry.priority / 10,
          inflection: candidate.reasons,
          strong: true
        }))
    })

    const prefixIds = yield* findFormPrefix(db, full, 40)
    const ranks = yield* entryRanks(db, prefixIds)
    const prefix = prefixIds.map((entryId, index): Hit => ({
      entryId,
      score: 400 - index + (ranks.get(entryId)?.common ? 50 : 0),
      inflection: [],
      strong: false
    }))
    return keepBest([...exact, ...prefix])
  })

  /**
   * Japanese words whose English glosses match an English query, and `directScore`: the best
   * score among glosses with every word of the query. Fallback hits never count there, so a
   * near-miss English gloss can't outrank the word a romaji query spells ("taberu" vs "table").
   */
  const englishGlossHits = Effect.fnUntraced(function* (query: string) {
    const terms = englishSearchTerms(query)
    const exact = yield* findGlossesExact(db, query, 300)
    const strict = terms === null ? [] : yield* searchGlosses(db, [terms], 600)
    const { relaxed, fuzzy } = yield* englishFallback(
      query,
      unique([...exact, ...strict].map((m) => m.entryId)).length,
      {
        relaxed: (relaxedTerms) => searchGlosses(db, relaxedTerms, 200),
        fuzzy: () => searchGlossesFuzzy(db, query, 200)
      }
    )

    const norm = normalizeGloss(query)
    const phraseNorm = normalizeEnglishPhrase(query)
    const allMatches = [...exact, ...strict, ...relaxed, ...fuzzy]
    const ranks = yield* entryRanks(db, unique(allMatches.map((match) => match.entryId)))
    const score = (match: GlossMatch, isExact: boolean, strong: boolean, penalty = 0): Hit => {
      const phraseExact = isExact || (phraseNorm.length > 0 && normalizeEnglishPhrase(match.text) === phraseNorm)
      const literalBonus = phraseExact && normalizeGloss(match.text) === norm ? 5 : 0
      return {
        entryId: match.entryId,
        score:
          glossScore(match, phraseExact, phraseNorm || norm, normalizeEnglishPhrase, ranks.get(match.entryId)) +
          literalBonus -
          penalty,
        inflection: [],
        strong
      }
    }
    const direct = [...exact.map((m) => score(m, true, true)), ...strict.map((m) => score(m, false, true))]
    return {
      hits: keepBest([
        ...direct,
        ...relaxed.map((m) => score(m, false, false, 15 - proximity(m.rank))),
        ...fuzzy.map((m) => score(m, false, false, 20))
      ]),
      directScore: Math.max(0, ...direct.map((hit) => hit.score))
    }
  })

  /**
   * The words of the `to` dictionary that the sources' glosses name: the bridge between the
   * two dictionaries, for words one glosses that the other's glosses miss. A gloss that is a
   * word's form names it. Japanese has no spaces to find words by, so a Japanese gloss no form
   * matches whole names the longest word inside it, ranked lower: "蛙化現象のきっかけ" →
   * 蛙化現象. A bridged word answers the query only when both legs are exact: the source is the
   * query as written, and the gloss is the word's form.
   */
  const bridgeHits = Effect.fnUntraced(function* (sources: ReadonlyArray<BridgeSource>, to: Language) {
    const normalize = to === "en" ? normalizeGloss : normalizeJapaneseGloss
    const named = sources
      .flatMap(({ record, exact }, order) =>
        record.senses.slice(0, BRIDGE_SENSES).flatMap((sense, senseIndex) =>
          sense.glosses
            .slice(0, BRIDGE_GLOSSES)
            .filter((gloss) => gloss.type === null || !BRIDGE_SKIPS.has(gloss.type))
            .map((gloss, position) => ({
              term: normalize(gloss.text),
              exact,
              weight: 90 - 10 * senseIndex - 3 * position - 5 * order - tagPenalty(sense.misc)
            }))
        )
      )
      .filter((name) => name.term.length > 0)
    if (named.length === 0) return []

    // English forms are matched case-folded; JMDict's "to eat" names eat, not the acronym EAT.
    const key = (text: string) => (to === "en" ? text.toLowerCase() : text)
    const formsOf = (matches: ReadonlyArray<FormMatch>) => {
      const byText = new Map<string, Array<FormMatch>>()
      for (const match of matches) {
        if (to === "en" && (match.kind !== "spelling" || isAcronym(match.text))) continue
        byText.set(key(match.text), [...(byText.get(key(match.text)) ?? []), match])
      }
      return byText
    }
    const whole = formsOf(yield* findForms(db, unique(named.map((name) => name.term)), to, "listed"))
    const unmatched = to === "ja" ? named.filter((name) => !whole.has(name.term)) : []
    const glosses = unique(unmatched.map((name) => name.term)).filter((term) => term.length <= INSIDE_GLOSS_MAX)
    const inside = formsOf(
      glosses.length === 0 ? [] : yield* findForms(db, unique(glosses.flatMap(stretches)), to, "listed")
    )

    const links = named.flatMap((name) => {
      const matched = whole.get(key(name.term))
      if (matched !== undefined) return matched.map((match) => ({ match, weight: name.weight, strong: name.exact }))
      const word = name.term.length > INSIDE_GLOSS_MAX ? undefined : stretches(name.term).find((s) => inside.has(s))
      return (word === undefined ? [] : inside.get(word)!).map((match) => ({
        match,
        weight: name.weight - INSIDE_PENALTY,
        strong: false
      }))
    })
    const ranks = yield* entryRanks(db, unique(links.map((link) => link.match.entryId)))
    // An entry reached both ways keeps its best score, and answers the query if either leg pair does.
    const best = new Map<EntryId, Hit>()
    for (const { match, weight, strong } of links) {
      const rank = ranks.get(match.entryId)
      const score = weight + (rank?.common ? 30 : 0) + (rank?.priority ?? 0) / 5
      const current = best.get(match.entryId)
      best.set(match.entryId, {
        entryId: match.entryId,
        score: Math.max(score, current?.score ?? -Infinity),
        inflection: [],
        strong: strong || (current?.strong ?? false)
      })
    }
    return [...best.values()]
  })

  /**
   * Japanese words reached through the English dictionary: the English word the query is, and
   * the Japanese words its glosses name ("ick" → 蛙化現象, which JMDict doesn't gloss as "the
   * ick"). Only the query as written is an exact leg; a guess at its base form isn't.
   */
  const englishBridgeHits = Effect.fnUntraced(function* (query: string) {
    const lower = query.toLowerCase()
    const matches = (yield* findForms(
      db,
      unique([lower, ...uninflect(lower).map((guess) => guess.base)]),
      "en",
      "listed"
    ))
      // The acronym spelled like the word ("ICK" for "ick") is another word, unless typed so.
      .filter((match) => match.text === query || !isAcronym(match.text))
    const exact = new Set(matches.filter((match) => match.text.toLowerCase() === lower).map((m) => m.entryId))
    const ids = unique([...exact, ...matches.map((match) => match.entryId)]).slice(0, BRIDGE_WORDS)
    const records = yield* getEntries(db, ids)
    return yield* bridgeHits(
      records.map((record) => ({ record, exact: exact.has(record.id) })),
      "ja"
    )
  })

  const searchJapanese = Effect.fnUntraced(function* (query: string) {
    if (hasJapanese(query)) return { mode: "japanese" as const, reading: null, hits: yield* japaneseHits(query) }

    const [byGloss, bridged] = yield* Effect.all([englishGlossHits(query), englishBridgeHits(query)])
    const english = keepBest([...byGloss.hits, ...bridged])
    const directScore = Math.max(byGloss.directScore, ...bridged.filter((hit) => hit.strong).map((hit) => hit.score))
    const kana = romajiToKana(query)
    const romaji = kana === null ? [] : (yield* japaneseHits(kana)).filter((hit) => hit.score >= 700)
    const englishIsStrong = directScore >= 150
    const fullwidth =
      isAcronym(query) || (!englishIsStrong && romaji.length === 0 && !/\s/.test(query))
        ? yield* japaneseHits(toFullwidth(query.toUpperCase()))
        : []
    if (fullwidth.some((hit) => hit.score >= 700)) {
      return {
        mode: "japanese" as const,
        reading: null,
        hits: keepBest([...fullwidth, ...english.map((h) => ({ ...h, score: h.score - 1000 }))])
      }
    }
    const preferRomaji = romaji.length > 0 && !englishIsStrong
    const hits = preferRomaji
      ? keepBest([...romaji, ...english.map((h) => ({ ...h, score: h.score - 1000 }))])
      : [...english, ...romaji.filter((hit) => !english.some((e) => e.entryId === hit.entryId))]
    return {
      mode: preferRomaji ? ("romaji" as const) : ("english" as const),
      reading: preferRomaji ? kana : null,
      hits
    }
  })

  // ---------------------------------------------------------------------
  // Search: English words, the same way round for English learners
  // ---------------------------------------------------------------------

  /**
   * English words by their spelling, the way Japanese words are found by their forms:
   * as written, through their inflections ("ate" finds eat, marked past), by prefix,
   * and for phrases or typos by stemmed tokens and trigram similarity.
   * Words whose sources list no inflections are reached by the regular rules ("teams").
   */
  const englishWordHits = Effect.fnUntraced(function* (query: string) {
    const guesses = uninflect(query)
    const variants = unique([query, ...englishPhraseVariants(query)])
    const [matches, guessed] = yield* Effect.all([
      findForms(db, variants, "en", "listed"),
      guesses.length === 0
        ? Effect.succeed([])
        : findForms(
            db,
            guesses.map((guess) => guess.base),
            "en",
            "listed"
          )
    ])
    const prefixIds = yield* findFormPrefix(db, query, 40, "en")
    const terms = englishSearchTerms(query)
    const isPhrase = /\s/.test(query)
    const hasDirect = matches.length > 0 || guessed.length > 0 || prefixIds.length > 0
    const strict = terms !== null && (isPhrase || !hasDirect) ? yield* searchForms(db, [terms], 60) : []
    const found = unique([...matches, ...guessed, ...strict].map((m) => m.entryId).concat(prefixIds))
    const { relaxed, fuzzy } = yield* englishFallback(query, found.length, {
      relaxed: (relaxedTerms) => searchForms(db, relaxedTerms, 40),
      fuzzy: () => searchFormsFuzzy(db, query, 40)
    })

    const ranks = yield* entryRanks(db, unique([...found, ...[...relaxed, ...fuzzy].map((m) => m.entryId)]))
    const guessedEntries = new Map(
      (yield* getEntries(db, unique(guessed.map((match) => match.entryId)))).map((entry) => [entry.id, entry])
    )
    const lowerQuery = query.toLowerCase()
    const phraseNorm = normalizeEnglishPhrase(query)

    const exact = matches.map((match): Hit => {
      const inflected = match.kind === "inflection"
      const isDirect = match.text.toLowerCase() === lowerQuery
      // An acronym spelled like the word looked up ("EAT" for "eat") is another word altogether.
      const acronym = match.text !== query && isAcronym(match.text)
      const base = acronym ? 350 : inflected ? 800 : isDirect ? 1000 : 900
      return {
        entryId: match.entryId,
        score: formScore(base, match.text === query, ranks.get(match.entryId)),
        inflection: inflected ? match.tags : [],
        strong: !acronym
      }
    })
    const byRule = guessed
      // "started" is start's past, not START's.
      .filter((match) => match.kind === "spelling" && !isAcronym(match.text))
      .map((match): Hit => {
        const guess = guesses.find((candidate) => candidate.base === match.text.toLowerCase())
        return {
          entryId: match.entryId,
          score: formScore(750, false, ranks.get(match.entryId)),
          inflection: guessedInflection(guess?.tags ?? [], guessedEntries.get(match.entryId)),
          strong: true
        }
      })
    const prefix = prefixIds.map((entryId, index): Hit => ({
      entryId,
      score: 400 - index + (ranks.get(entryId)?.common ? 50 : 0),
      inflection: [],
      strong: false
    }))
    // A phrase with every word of the query answers it; one that merely shares the words resembles it.
    const byTokens = strict.map((match): Hit => {
      const phraseExact = phraseNorm.length > 0 && normalizeEnglishPhrase(match.text) === phraseNorm
      return {
        entryId: match.entryId,
        score: formScore(phraseExact ? 720 : 500, false, ranks.get(match.entryId)) + Math.min(10, -match.rank),
        inflection: [],
        strong: phraseExact
      }
    })
    const byRelaxed = relaxed.map((match): Hit => ({
      entryId: match.entryId,
      score: formScore(320, false, ranks.get(match.entryId)) + proximity(match.rank),
      inflection: [],
      strong: false
    }))
    const byFuzzy = fuzzy.map((match): Hit => ({
      entryId: match.entryId,
      score: formScore(250 + Math.round(match.similarity * 100), false, ranks.get(match.entryId)),
      inflection: [],
      strong: false
    }))
    return keepBest([...exact, ...byRule, ...byTokens, ...prefix, ...byRelaxed, ...byFuzzy])
  })

  /**
   * English words for a Japanese query, the way Japanese words are found for an English
   * one: by their Japanese glosses, as typed or in dictionary form (食べなかった → 食べる),
   * and through JMDict, whose English glosses for the Japanese word name English words
   * (たべる → 食べる → "to eat" → eat). Glosses that only contain the query come last.
   */
  const japaneseGlossHits = Effect.fnUntraced(function* (query: string) {
    // Adjectival nouns and no-adjectives are glossed as they modify a noun: きれい → きれいな, 禿げ → 禿げの.
    const glossNorms = (term: string) => {
      const base = normalizeJapaneseGloss(term)
      return base.length === 0 ? [] : [base, `${base}な`, `${base}の`]
    }
    // The Japanese words the query is, and the English words their glosses name. When the query is
    // already a dictionary word (ハゲ → 禿), imperative lookalikes (はげ → 剥ぐ, 接ぐ) are left aside.
    const allJapanese = (yield* japaneseHits(query)).filter((hit) => hit.score >= 700)
    const uninflected = allJapanese.filter((hit) => hit.inflection.length === 0)
    const japanese = (uninflected.length > 0 ? uninflected : allJapanese).slice(0, BRIDGE_WORDS)
    const records = yield* getEntries(
      db,
      japanese.map((hit) => hit.entryId)
    )

    const variants = unique([query, katakanaToHiragana(query)])
    const terms = unique(
      variants.flatMap((variant) =>
        deinflect(variant)
          .filter((candidate) => uninflected.length === 0 || candidate.reasons.length === 0)
          .map((candidate) => candidate.term)
      )
    )
    const norms = unique(terms.flatMap(glossNorms))
    const norm = normalizeJapaneseGloss(query)
    // Glosses write those words in kanji where the query may be their reading: baldy is glossed
    // 禿 and bald 禿げの, not ハゲ. Only kanji, which is the word's own; a reading is shared with
    // its homophones, and an obscure homophone (接ぐ as はぐ) yields when a common word matches.
    const commonRecords = records.filter((record) => record.common)
    const spellingRecords = commonRecords.length > 0 ? commonRecords : records
    const spellings = new Set(
      spellingRecords
        .flatMap((record) => record.forms.filter((form) => form.kind === "kanji" && !form.tags.includes("sK")))
        .flatMap((form) => glossNorms(form.text))
        .filter((spelling) => !norms.includes(spelling))
    )
    const exact = yield* findJapaneseGlosses(db, [...norms, ...spellings], 300)
    const fuzzy = exact.length >= 20 ? [] : yield* searchJapaneseGlosses(db, norm, 200)
    const viaJmdict = yield* bridgeHits(
      records.map((record) => ({ record, exact: true })),
      "en"
    )

    const ranks = yield* entryRanks(db, unique([...exact, ...fuzzy].map((match) => match.entryId)))
    const score = (match: GlossMatch, isExact: boolean, penalty = 0): Hit => ({
      entryId: match.entryId,
      score: glossScore(match, isExact, norm, normalizeJapaneseGloss, ranks.get(match.entryId)) - penalty,
      inflection: [],
      strong: isExact
    })
    const answers = keepBest([
      ...exact.map((m) => score(m, true, spellings.has(normalizeJapaneseGloss(m.text)) ? SPELLING_PENALTY : 0)),
      ...viaJmdict
    ])
    // A gloss that only contains the query names something else (ハゲタカ is a vulture), so it
    // comes after every word that answers the query, in its own order.
    const answered = new Set(answers.map((hit) => hit.entryId))
    const contains = keepBest(fuzzy.filter((m) => !answered.has(m.entryId)).map((m) => score(m, false)))
    const lowest = Math.min(...answers.map((hit) => hit.score))
    const highest = Math.max(...contains.map((hit) => hit.score))
    const shift = Math.max(0, highest - lowest + 1)
    return [...answers, ...contains.map((hit) => ({ ...hit, score: hit.score - shift }))]
  })

  const searchEnglish = Effect.fnUntraced(function* (query: string) {
    if (hasJapanese(query)) return { mode: "japanese" as const, reading: null, hits: yield* japaneseGlossHits(query) }

    const english = yield* englishWordHits(query)
    // Romaji for a Japanese word is read as such only when it isn't an English word: "kirei", not "sake".
    const kana = (english[0]?.score ?? 0) >= 700 ? null : romajiToKana(query)
    const romaji = kana === null ? [] : (yield* japaneseGlossHits(kana)).filter((hit) => hit.score >= 90)
    if (kana === null || romaji.length === 0) return { mode: "english" as const, reading: null, hits: english }
    return {
      mode: "romaji" as const,
      reading: kana,
      hits: keepBest([...romaji, ...english.map((hit) => ({ ...hit, score: hit.score - 1000 }))])
    }
  })

  /**
   * The hits a learner may see, approved words first: Kotori's unreviewed drafts come after every
   * approved word, in their own order, and discarded ones not at all (ADR 0002).
   */
  const listedFirst = Effect.fnUntraced(function* (hits: ReadonlyArray<Hit>) {
    const ranks = yield* entryRanks(db, unique(hits.map((hit) => hit.entryId)))
    const approved: Array<Hit> = []
    const drafts: Array<Hit> = []
    for (const hit of hits) {
      const review = ranks.get(hit.entryId)?.review
      switch (review) {
        case "approved":
          approved.push(hit)
          break
        case "unreviewed":
          drafts.push(hit)
          break
        case "discarded":
        case undefined:
          break
      }
    }
    return [...approved, ...drafts]
  })

  const summaries = Effect.fnUntraced(function* (hits: ReadonlyArray<Hit>) {
    const ids = hits.map((hit) => hit.entryId)
    const entries = new Map((yield* getEntries(db, ids)).map((entry) => [entry.id, entry]))
    const labels = yield* labelsBySense(db, ids)
    const clips = yield* entryClips(db, ids)
    return hits.flatMap((hit): Array<EntrySummary> => {
      const entry = entries.get(hit.entryId)
      if (entry === undefined) return []
      const firstClip = clips.get(hit.entryId)?.[0]
      return [
        {
          id: EntryId.make(entry.id),
          language: entry.language,
          headword: entry.headword,
          reading: entry.reading,
          romaji: entry.language === "ja" ? romanize(entry.reading) : "",
          common: entry.common,
          review: entry.review,
          meanings: firstGlosses(entry, 3),
          partOfSpeech: entry.senses[0]?.pos[0] ?? null,
          labels: wordLabels(entry, labels.get(entry.id)),
          inflection: hit.inflection,
          audioUrl: firstClip === undefined ? null : audioUrl(firstClip.key)
        }
      ]
    })
  })

  const search = Effect.fn("Dictionary.search")(function* (raw: string, language: Language, limit: number) {
    const query = raw.normalize("NFKC").trim()
    if (query.length === 0)
      return { query, mode: "english" as const, reading: null, match: "none" as const, entries: [] }
    const { mode, reading, hits } = language === "ja" ? yield* searchJapanese(query) : yield* searchEnglish(query)
    const shown = (yield* listedFirst(hits)).slice(0, limit)
    return { query, mode, reading, match: matchOf(shown), entries: yield* summaries(shown) }
  })

  const lookupWords = Effect.fn("Dictionary.lookupWords")(function* (
    words: ReadonlyArray<{ readonly word: string; readonly reading: string }>,
    language: Language
  ) {
    const matches = yield* findForms(db, unique(words.flatMap((w) => [w.word, w.reading])), language)
    const ranks = yield* entryRanks(db, unique(matches.map((m) => m.entryId)))
    const fold = (text: string) => (language === "en" ? text.toLowerCase() : text)
    return words.map(({ word, reading }) => {
      const candidates = matches.filter((m) => fold(m.text) === fold(word) || fold(m.text) === fold(reading))
      // Prefer an entry matching both spelling and reading (English words are their own reading),
      // then the word as written rather than an inflection of another, then the most frequent.
      const best = candidates
        .map((m) => ({
          id: m.entryId,
          score:
            (candidates.filter((c) => c.entryId === m.entryId).length > 1 ? 1000 : 0) +
            (m.text === word ? 100 : 0) +
            (m.kind === "inflection" ? -50 : 0) +
            (ranks.get(m.entryId)?.priority ?? 0)
        }))
        .sort((a, b) => b.score - a.score)[0]
      return best === undefined ? null : EntryId.make(best.id)
    })
  })

  const summarize = Effect.fn("Dictionary.summarize")(function* (ids: ReadonlyArray<EntryId>) {
    return yield* summaries(ids.map((entryId) => ({ entryId, score: 0, inflection: [], strong: true })))
  })

  return { search, summarize, lookupWords } satisfies {
    search(query: string, language: Language, limit: number): Effect.Effect<SearchResult>
    summarize(ids: ReadonlyArray<EntryId>): Effect.Effect<ReadonlyArray<EntrySummary>>
    lookupWords(
      words: ReadonlyArray<{ readonly word: string; readonly reading: string }>,
      language: Language
    ): Effect.Effect<ReadonlyArray<EntryId | null>>
  }
}
