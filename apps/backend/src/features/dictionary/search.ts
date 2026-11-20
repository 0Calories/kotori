import {
  EntryId,
  type EntryRecord,
  type EntrySummary,
  type Label,
  type Language,
  REVIEW_RULES,
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

interface Hit {
  readonly entryId: EntryId
  readonly score: number
  readonly inflection: ReadonlyArray<string>
  readonly strong: boolean
}

const matchOf = (hits: ReadonlyArray<Hit>): SearchMatch =>
  hits.length === 0 ? "none" : hits.some((hit) => hit.strong) ? "exact" : "weak"

const keepBest = (hits: Iterable<Hit>) => keepBestBy(hits, (hit) => hit.entryId)

const SENSE_BONUS = [40, 25, 15, 10, 5]

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

// ts_rank_cd is ~0.1 for adjacent words (negated in rank), scaling word proximity to 0..10.
const proximity = (rank: number) => Math.min(10, Math.round(-100 * rank))

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

const formScore = (
  base: number,
  exactCase: boolean,
  rank: { readonly common: boolean; readonly priority: number } | undefined
) => base + (exactCase ? 20 : 0) + (rank?.common ? 50 : 0) + (rank?.priority ?? 0) / 10

const isAcronym = (text: string) => /[A-Z]{2}/.test(text)

// Skip JMdict explanatory, literal, and trademark glosses when bridging to English headwords.
const BRIDGE_SKIPS = new Set(["expl", "lit", "tm"])
const BRIDGE_WORDS = 5
const BRIDGE_SENSES = 2
const BRIDGE_GLOSSES = 4
const INSIDE_GLOSS_MAX = 20
const INSIDE_WORD_MAX = 10
const SPELLING_PENALTY = 10
const INSIDE_PENALTY = 30

interface BridgeSource {
  readonly record: EntryRecord
  readonly exact: boolean
}

const stretches = (gloss: string) => {
  const found: Array<string> = []
  for (let length = Math.min(gloss.length - 1, INSIDE_WORD_MAX); length >= 2; length--) {
    for (let start = 0; start + length <= gloss.length; start++) found.push(gloss.slice(start, start + length))
  }
  return found
}

const wordLabels = (entry: EntryRecord, bySense: ReadonlyMap<number, ReadonlyArray<Label>> | undefined) =>
  senseLabels(entry.senses.map((_, index) => bySense?.get(index) ?? [])).word

const guessedInflection = (tags: ReadonlyArray<string>, entry: EntryRecord | undefined) => {
  if (!(tags.includes("plural") && tags.includes("third-person"))) return tags
  const senses = entry?.senses ?? []
  if (senses.some((sense) => sense.pos.includes("n") || sense.pos.length === 0)) return ["plural"]
  return senses.some((sense) => sense.pos.includes("v")) ? ["third-person"] : []
}

export const makeSearch = (db: DatabaseShape) => {
  const japaneseHits = Effect.fnUntraced(function* (query: string) {
    const full = toFullwidth(query)
    const variants = unique([query, full, katakanaToHiragana(query), katakanaToHiragana(full)])
    const candidates = variants.flatMap(deinflect)
    const matches = yield* findForms(db, unique(candidates.map((candidate) => candidate.term)), "ja", "searchable")
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

  // Exclude relaxed and fuzzy fallback hits from directScore so near-miss English glosses ("table") cannot outrank exact romaji ("taberu").
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

    const key = (text: string) => (to === "en" ? text.toLowerCase() : text)
    const formsOf = (matches: ReadonlyArray<FormMatch>) => {
      const byText = new Map<string, Array<FormMatch>>()
      for (const match of matches) {
        if (to === "en" && (match.kind !== "spelling" || isAcronym(match.text))) continue
        byText.set(key(match.text), [...(byText.get(key(match.text)) ?? []), match])
      }
      return byText
    }
    const whole = formsOf(yield* findForms(db, unique(named.map((name) => name.term)), to, "searchable"))
    // Unspaced Japanese glosses ("蛙化現象のきっかけ") have no word boundaries, so match the longest dictionary form substring when the whole gloss misses.
    const unmatched = to === "ja" ? named.filter((name) => !whole.has(name.term)) : []
    const glosses = unique(unmatched.map((name) => name.term)).filter((term) => term.length <= INSIDE_GLOSS_MAX)
    const inside = formsOf(
      glosses.length === 0 ? [] : yield* findForms(db, unique(glosses.flatMap(stretches)), to, "searchable")
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

  const englishBridgeHits = Effect.fnUntraced(function* (query: string) {
    const lower = query.toLowerCase()
    const matches = (yield* findForms(
      db,
      unique([lower, ...uninflect(lower).map((guess) => guess.base)]),
      "en",
      "searchable"
    )).filter((match) => match.text === query || !isAcronym(match.text))
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

  const englishWordHits = Effect.fnUntraced(function* (query: string) {
    const guesses = uninflect(query)
    const variants = unique([query, ...englishPhraseVariants(query)])
    const [matches, guessed] = yield* Effect.all([
      findForms(db, variants, "en", "searchable"),
      guesses.length === 0
        ? Effect.succeed([])
        : findForms(
            db,
            guesses.map((guess) => guess.base),
            "en",
            "searchable"
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

  const japaneseGlossHits = Effect.fnUntraced(function* (query: string) {
    // Japanese glosses of English adjectives often carry trailing な or の (きれいな, 禿げの).
    const glossNorms = (term: string) => {
      const base = normalizeJapaneseGloss(term)
      return base.length === 0 ? [] : [base, `${base}な`, `${base}の`]
    }
    // Prefer uninflected matches so dictionary words (ハゲ → 禿) are not diluted by imperative homophones (はげ → 剥ぐ).
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
    // Include kanji forms of matched Japanese words so kana queries (ハゲ) match kanji-only English glosses (禿), excluding shared kana readings.
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
    // Shift substring-only gloss hits below all exact and bridged hits so partial matches (ハゲタカ for ハゲ) never interleave.
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
    const kana = (english[0]?.score ?? 0) >= 700 ? null : romajiToKana(query)
    const romaji = kana === null ? [] : (yield* japaneseGlossHits(kana)).filter((hit) => hit.score >= 90)
    if (kana === null || romaji.length === 0) return { mode: "english" as const, reading: null, hits: english }
    return {
      mode: "romaji" as const,
      reading: kana,
      hits: keepBest([...romaji, ...english.map((hit) => ({ ...hit, score: hit.score - 1000 }))])
    }
  })

  const listedFirst = Effect.fnUntraced(function* (hits: ReadonlyArray<Hit>) {
    const ranks = yield* entryRanks(db, unique(hits.map((hit) => hit.entryId)))
    const approved: Array<Hit> = []
    const drafts: Array<Hit> = []
    for (const hit of hits) {
      const review = ranks.get(hit.entryId)?.review
      if (review === undefined || !REVIEW_RULES[review].searchable) continue
      ;(REVIEW_RULES[review].inDictionary ? approved : drafts).push(hit)
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
