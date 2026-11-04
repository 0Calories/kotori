import { awaitsWarning, CASTS, Claude, Jev, nuanceOutdated, Pronouncer } from "@kotori/ai"
import {
  type Enrichment,
  type EnrichmentStatus,
  type Entry,
  EntryId,
  type EntryRecord,
  type EntrySummary,
  type Example,
  type Language,
  type SearchResult,
  type Sense,
  type SimilarWord,
  type Tag
} from "@kotori/contracts"
import {
  deinflect,
  englishPhraseVariants,
  englishSearchTerms,
  hasJapanese,
  katakanaToHiragana,
  matchesPartOfSpeech,
  normalizeEnglishPhrase,
  normalizeGloss,
  normalizeJapaneseGloss,
  relaxedEnglishSearchTerms,
  romajiToKana,
  romanize,
  uninflect
} from "@kotori/language"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { entryClips, exampleClips } from "../audio/index.ts"
import type { ExampleRow, JobKind } from "../enrichment/index.ts"
import { examplesFor, loanWordsFor, nuanceFor, senseNotesFor, similarFor } from "../enrichment/index.ts"
import { enqueueJob, jobStatusFor, refillJob, requeueJob } from "../enrichment/index.ts"
import type { FormMatch, GlossMatch } from "./queries.ts"
import {
  findFormPrefix,
  findForms,
  findGlossesExact,
  findJapaneseGlosses,
  getEntries,
  entryRanks,
  searchForms,
  searchFormsFuzzy,
  searchGlosses,
  searchGlossesFuzzy,
  searchJapaneseGlosses,
  tagLabels
} from "./queries.ts"

export const audioUrl = (key: string) => `/audio/${key}.mp3`

/** Priority for work requested by someone looking at an entry, above any batch backfill. */
const ON_DEMAND = 1_000

/** How long a finished audio job that left gaps waits before it is tried again. */
const REFILL_AFTER = 60 * 60 * 1000
/** How long after a nuance job a viewed entry's missing loan warning gets another try. */
const WARNING_RETRY_AFTER = 10 * 60 * 1000

interface Hit {
  readonly entryId: EntryId
  readonly score: number
  readonly inflection: ReadonlyArray<string>
}

const keepBest = (hits: Iterable<Hit>) => {
  const best = new Map<EntryId, Hit>()
  for (const hit of hits) {
    const current = best.get(hit.entryId)
    if (current === undefined || hit.score > current.score) best.set(hit.entryId, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

const unique = <A>(items: Iterable<A>) => [...new Set(items)]

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

const toFullwidth = (text: string) =>
  text.replace(/[\u0021-\u007e]/g, (ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0))

/** JMDict's explanations, literal renderings and trademarks aren't English words to look up. */
const BRIDGE_SKIPS = new Set(["expl", "lit", "tm"])
/** The Japanese words whose glosses lead to English words, and how many of their senses and glosses. */
const BRIDGE_WORDS = 5
const BRIDGE_SENSES = 2
const BRIDGE_GLOSSES = 4

const toExample = (example: ExampleRow, clips: ReadonlyMap<string, string>): Example => {
  const ja = clips.get(`${example.id}:ja`)
  const en = clips.get(`${example.id}:en`)
  return {
    id: example.id,
    ja: example.ja,
    furigana: example.furigana,
    en: example.en,
    formality: example.formality,
    note: example.note,
    noteJa: example.noteJa,
    audioUrl: ja === undefined ? null : audioUrl(ja),
    translationAudioUrl: en === undefined ? null : audioUrl(en)
  }
}

const firstGlosses = (entry: EntryRecord, count: number) => {
  const meanings = entry.senses[0]?.glosses.slice(0, count).map((gloss) => gloss.text) ?? []
  const second = entry.senses[1]?.glosses[0]?.text
  return meanings.length < count && second !== undefined ? [...meanings, second] : meanings
}

/** Glosses run together as each language lists them: "to eat; to dine", "食べる、食事をする". */
const joinGlosses = (entry: EntryRecord, glosses: ReadonlyArray<string>) =>
  glosses.join(entry.language === "ja" ? "; " : "、")

/**
 * What a similar word means where it is like the sense it is listed under: its earliest sense
 * sharing a gloss with that sense, as the nuance job's candidate search found it, so "strain"
 * under "tension" reads 緊張 rather than its first sense, 性質. A cross-reference shares none,
 * and shows the word's first meanings.
 */
const similarMeaning = (sense: EntryRecord["senses"][number], similar: EntryRecord) => {
  // Glosses are in the other language from the headword, normalised as the import stores them.
  const norm = similar.language === "ja" ? normalizeGloss : normalizeJapaneseGloss
  const own = new Set(sense.glosses.map((gloss) => norm(gloss.text)).filter((text) => text.length > 1))
  const shared = similar.senses.find((candidate) => candidate.glosses.some((gloss) => own.has(norm(gloss.text))))
  return joinGlosses(
    similar,
    shared === undefined ? firstGlosses(similar, 2) : shared.glosses.slice(0, 2).map((gloss) => gloss.text)
  )
}

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

export class Dictionary extends Context.Service<
  Dictionary,
  {
    /** Searches the dictionary of `language`: Japanese words for learners of Japanese, English ones for learners of English. */
    search(query: string, language: Language, limit: number): Effect.Effect<SearchResult>
    entry(id: EntryId): Effect.Effect<Option.Option<Entry>>
    /** Queues whatever enrichment an entry is missing, returning its status. */
    requestEnrichment(id: EntryId): Effect.Effect<Option.Option<Enrichment>>
    /** Entry ids for words in `language`, for linking coach vocabulary to the dictionary. */
    lookupWords(
      words: ReadonlyArray<{ readonly word: string; readonly reading: string }>,
      language: Language
    ): Effect.Effect<ReadonlyArray<EntryId | null>>
  }
>()("@kotori/backend/Dictionary") {
  static readonly layer = Layer.effect(
    Dictionary,
    Effect.gen(function* () {
      const db = yield* Database
      const jev = yield* Jev
      const claude = yield* Claude
      const pronouncer = yield* Pronouncer

      // ---------------------------------------------------------------------
      // Search: Japanese words
      // ---------------------------------------------------------------------

      const japaneseHits = Effect.fnUntraced(function* (query: string) {
        const full = toFullwidth(query)
        const variants = unique([query, full, katakanaToHiragana(query), katakanaToHiragana(full)])
        const candidates = variants.flatMap(deinflect)
        const matches = yield* findForms(db, unique(candidates.map((candidate) => candidate.term)))
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
              inflection: candidate.reasons
            }))
        })

        const prefixIds = yield* findFormPrefix(db, full, 40)
        const ranks = yield* entryRanks(db, prefixIds)
        const prefix = prefixIds.map((entryId, index): Hit => ({
          entryId,
          score: 400 - index + (ranks.get(entryId)?.common ? 50 : 0),
          inflection: []
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
        const score = (match: GlossMatch, isExact: boolean, penalty = 0): Hit => {
          const phraseExact = isExact || (phraseNorm.length > 0 && normalizeEnglishPhrase(match.text) === phraseNorm)
          const literalBonus = phraseExact && normalizeGloss(match.text) === norm ? 5 : 0
          return {
            entryId: match.entryId,
            score:
              glossScore(match, phraseExact, phraseNorm || norm, normalizeEnglishPhrase, ranks.get(match.entryId)) +
              literalBonus -
              penalty,
            inflection: []
          }
        }
        const direct = [...exact.map((m) => score(m, true)), ...strict.map((m) => score(m, false))]
        return {
          hits: keepBest([
            ...direct,
            ...relaxed.map((m) => score(m, false, 15 - proximity(m.rank))),
            ...fuzzy.map((m) => score(m, false, 20))
          ]),
          directScore: Math.max(0, ...direct.map((hit) => hit.score))
        }
      })

      const searchJapanese = Effect.fnUntraced(function* (query: string) {
        if (hasJapanese(query)) return { mode: "japanese" as const, reading: null, hits: yield* japaneseHits(query) }

        const { hits: english, directScore } = yield* englishGlossHits(query)
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
      // Search: English words, the same way round for Japanese speakers
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
          findForms(db, variants, "en"),
          guesses.length === 0
            ? Effect.succeed([])
            : findForms(
                db,
                guesses.map((guess) => guess.base),
                "en"
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
            inflection: inflected ? match.tags : []
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
              inflection: guessedInflection(guess?.tags ?? [], guessedEntries.get(match.entryId))
            }
          })
        const prefix = prefixIds.map((entryId, index): Hit => ({
          entryId,
          score: 400 - index + (ranks.get(entryId)?.common ? 50 : 0),
          inflection: []
        }))
        const byTokens = strict.map((match): Hit => {
          const phraseExact = phraseNorm.length > 0 && normalizeEnglishPhrase(match.text) === phraseNorm
          return {
            entryId: match.entryId,
            score: formScore(phraseExact ? 720 : 500, false, ranks.get(match.entryId)) + Math.min(10, -match.rank),
            inflection: []
          }
        })
        const byRelaxed = relaxed.map((match): Hit => ({
          entryId: match.entryId,
          score: formScore(320, false, ranks.get(match.entryId)) + proximity(match.rank),
          inflection: []
        }))
        const byFuzzy = fuzzy.map((match): Hit => ({
          entryId: match.entryId,
          score: formScore(250 + Math.round(match.similarity * 100), false, ranks.get(match.entryId)),
          inflection: []
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
        const variants = unique([query, katakanaToHiragana(query)])
        const terms = unique(variants.flatMap((variant) => deinflect(variant).map((candidate) => candidate.term)))
        // Adjectival nouns are glossed as they modify a noun: きれい → きれいな.
        const norms = unique(terms.flatMap((term) => [normalizeJapaneseGloss(term), `${term}な`, `${term}の`]))
        const norm = normalizeJapaneseGloss(query)
        const exact = yield* findJapaneseGlosses(db, norms, 300)
        const fuzzy = exact.length >= 20 ? [] : yield* searchJapaneseGlosses(db, norm, 200)

        // The Japanese words the query is, and the English words their glosses name.
        const japanese = (yield* japaneseHits(query)).filter((hit) => hit.score >= 700).slice(0, BRIDGE_WORDS)
        const records = yield* getEntries(
          db,
          japanese.map((hit) => hit.entryId)
        )
        const named = records.flatMap((record, order) =>
          record.senses.slice(0, BRIDGE_SENSES).flatMap((sense, senseIndex) =>
            sense.glosses
              .slice(0, BRIDGE_GLOSSES)
              .filter((gloss) => gloss.type === null || !BRIDGE_SKIPS.has(gloss.type))
              .map((gloss, position) => ({
                term: normalizeGloss(gloss.text),
                weight: 90 - 10 * senseIndex - 3 * position - 5 * order - tagPenalty(sense.misc)
              }))
          )
        )
        const bridged: ReadonlyArray<FormMatch> =
          named.length === 0 ? [] : yield* findForms(db, unique(named.map((name) => name.term)), "en")

        const ranks = yield* entryRanks(db, unique([...exact, ...fuzzy, ...bridged].map((match) => match.entryId)))
        const score = (match: GlossMatch, isExact: boolean): Hit => ({
          entryId: match.entryId,
          score: glossScore(match, isExact, norm, normalizeJapaneseGloss, ranks.get(match.entryId)),
          inflection: []
        })
        const viaJmdict = bridged
          // JMDict's "to eat" names eat, not the acronym EAT.
          .filter((match) => match.kind === "spelling" && !isAcronym(match.text))
          .map((match): Hit => {
            const rank = ranks.get(match.entryId)
            const weight = Math.max(
              ...named.filter((name) => name.term === match.text.toLowerCase()).map((name) => name.weight)
            )
            return {
              entryId: match.entryId,
              score: weight + (rank?.common ? 30 : 0) + (rank?.priority ?? 0) / 5,
              inflection: []
            }
          })
        return keepBest([...exact.map((m) => score(m, true)), ...viaJmdict, ...fuzzy.map((m) => score(m, false))])
      })

      const searchEnglish = Effect.fnUntraced(function* (query: string) {
        if (hasJapanese(query))
          return { mode: "japanese" as const, reading: null, hits: yield* japaneseGlossHits(query) }

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

      const summaries = Effect.fnUntraced(function* (hits: ReadonlyArray<Hit>) {
        const ids = hits.map((hit) => hit.entryId)
        const entries = new Map((yield* getEntries(db, ids)).map((entry) => [entry.id, entry]))
        const nuance = yield* nuanceFor(db, ids)
        const formality = new Map(
          nuance.filter((row) => row.sense === 0).map((row) => [row.entryId, row.nuance.formality.value] as const)
        )
        return hits.flatMap((hit): Array<EntrySummary> => {
          const entry = entries.get(hit.entryId)
          if (entry === undefined) return []
          return [
            {
              id: EntryId.make(entry.id),
              language: entry.language,
              headword: entry.headword,
              reading: entry.reading,
              romaji: entry.language === "ja" ? romanize(entry.reading) : "",
              common: entry.common,
              meanings: firstGlosses(entry, 3),
              partOfSpeech: entry.senses[0]?.pos[0] ?? null,
              formality: formality.get(entry.id) ?? null,
              inflection: hit.inflection
            }
          ]
        })
      })

      const search = Effect.fn("Dictionary.search")(function* (raw: string, language: Language, limit: number) {
        const query = raw.normalize("NFKC").trim()
        if (query.length === 0) return { query, mode: "english" as const, reading: null, entries: [] }
        const { mode, reading, hits } = language === "ja" ? yield* searchJapanese(query) : yield* searchEnglish(query)
        return { query, mode, reading, entries: yield* summaries(hits.slice(0, limit)) }
      })

      // ---------------------------------------------------------------------
      // Entries
      // ---------------------------------------------------------------------

      const status = (ready: boolean, available: boolean, job: string | undefined): EnrichmentStatus =>
        ready ? "ready" : !available || job === "failed" ? "unavailable" : "queued"

      const enrichmentFor = Effect.fnUntraced(function* (entry: EntryRecord, enqueue: boolean) {
        const nuanceRows = yield* nuanceFor(db, [entry.id])
        const hasNuance = nuanceRows.length > 0
        // Old rows stay valid and shown, but a viewed entry gets fresh judgments queued when they
        // predate its question set, or a re-import has ranked an unjudged sense among them.
        const outdated = nuanceOutdated(entry, nuanceRows)
        const [loan] = yield* loanWordsFor(db, [entry.id])
        const examples = yield* examplesFor(db, [entry.id])
        const hasExamples = examples.length > 0
        const clips = yield* exampleClips(
          db,
          examples.map((example) => example.id)
        )
        // Ready once the headword and every example are voiced in the entry's language.
        const hasAudio =
          (yield* entryClips(db, [entry.id])).size > 0 &&
          examples.every((example) => clips.has(`${example.id}:${entry.language}`))
        const coachAvailable = yield* claude.available
        const now = new Date(yield* Clock.currentTimeMillis)

        if (enqueue) {
          const before = yield* jobStatusFor(db, entry.id)
          const retryWindow = new Date(now.getTime() - WARNING_RETRY_AFTER)
          // A job that already ran out of attempts stays `failed` while the entry is polled so its
          // status reports `unavailable` and the app stops polling; a later look gives it a new try.
          const queueOrRetry = (kind: JobKind) =>
            before.get(kind) === "failed"
              ? refillJob(db, kind, entry.id, retryWindow, ON_DEMAND, now)
              : enqueueJob(db, kind, entry.id, ON_DEMAND, now)

          if (jev.configured) {
            // Enqueueing a finished job is a no-op, so one that judged with an older question set is
            // queued again; saving replaces every row of the entry, so it runs once per version.
            if (outdated && before.get("nuance") === "done") {
              yield* requeueJob(db, "nuance", entry.id, ON_DEMAND, now)
            } else if (!hasNuance || outdated) {
              yield* queueOrRetry("nuance")
            } else if (coachAvailable && awaitsWarning(loan) && before.get("nuance") === "done") {
              // A drifted loan judged while Claude was unavailable has no warning: the job writes
              // just that, without Jev. Not on every look, in case Claude still can't write it.
              yield* refillJob(db, "nuance", entry.id, retryWindow, ON_DEMAND, now)
            }
          }
          if (!hasExamples && coachAvailable) yield* queueOrRetry("examples")
          // The worker re-runs audio once example sentences exist, so they get voiced too. A finished
          // job can still leave gaps (sentences written after it ran), so it runs again to fill
          // them, but at most once an hour, in case the gap is one the worker can't fill.
          if (!hasAudio && pronouncer.configured) {
            // Enqueueing a finished job would touch it, putting its next try off with every look.
            if (before.get("audio") === "done") {
              yield* refillJob(db, "audio", entry.id, new Date(now.getTime() - REFILL_AFTER), ON_DEMAND, now)
            } else {
              yield* queueOrRetry("audio")
            }
          }
        }

        const job = yield* jobStatusFor(db, entry.id)
        return {
          nuance: status(hasNuance, jev.configured, job.get("nuance")),
          examples: status(hasExamples, coachAvailable, job.get("examples")),
          // A finished job has voiced what it can; whatever is still missing isn't on its way.
          audio: status(hasAudio || job.get("audio") === "done", pronouncer.configured, job.get("audio"))
        }
      })

      const assemble = Effect.fnUntraced(function* (entry: EntryRecord) {
        const tags = yield* tagLabels(db)
        const tag = (code: string): Tag => ({ code, label: tags.get(code) ?? code })

        const nuance = new Map((yield* nuanceFor(db, [entry.id])).map((row) => [row.sense, row.nuance]))
        const notes = new Map((yield* senseNotesFor(db, [entry.id])).map((row) => [row.sense, row]))
        const [loan] = yield* loanWordsFor(db, [entry.id])
        const examples = yield* examplesFor(db, [entry.id])
        const exampleAudio = yield* exampleClips(
          db,
          examples.map((example) => example.id)
        )
        const headwordClips = (yield* entryClips(db, [entry.id])).get(entry.id) ?? []
        const voiceName = (voice: string | null) =>
          voice === null ? null : (CASTS[entry.language].find((candidate) => candidate.id === voice)?.name ?? null)

        const similarRows = yield* similarFor(db, entry.id)
        const similarIds = unique(similarRows.map((row) => row.similarId))
        const similarEntries = new Map((yield* getEntries(db, similarIds)).map((e) => [e.id, e]))
        const similarFormality = new Map(
          (yield* nuanceFor(db, similarIds))
            .filter((row) => row.sense === 0)
            .map((row) => [row.entryId, row.nuance.formality.value] as const)
        )

        // Cross-references point within the entry's own dictionary: JMDict's are "text・reading・sense",
        // an English word's are its synonyms and antonyms, matched whatever their case.
        const xrefTexts = unique(entry.senses.flatMap((s) => [...s.xrefs, ...s.antonyms]).map((x) => x.split("・")[0]!))
        const xrefMatches = yield* findForms(db, xrefTexts, entry.language)
        const fold = (text: string) => (entry.language === "en" ? text.toLowerCase() : text)
        const resolve = (xref: string) => {
          const [text = xref, reading] = xref.split("・")
          const match =
            xrefMatches.find((m) => m.text === text && m.kind !== "inflection") ??
            xrefMatches.find((m) => fold(m.text) === fold(text))
          return {
            text: reading !== undefined && !/^\d+$/.test(reading) ? `${text}（${reading}）` : text,
            entryId: match ? EntryId.make(match.entryId) : null
          }
        }

        const senses = entry.senses.map((sense, index): Sense => ({
          index,
          glosses: sense.glosses.map((gloss) => gloss.text),
          partsOfSpeech: sense.pos.map(tag),
          misc: sense.misc.map(tag),
          fields: sense.fields.map(tag),
          dialects: sense.dialects.map(tag),
          info: sense.info,
          appliesTo: [...sense.stagk, ...sense.stagr],
          related: sense.xrefs.map(resolve),
          antonyms: sense.antonyms.map(resolve),
          nuance: nuance.get(index) ?? null,
          note: notes.get(index)?.note ?? null,
          noteJa: notes.get(index)?.noteJa ?? null,
          similar: similarRows
            .filter((row) => row.sense === index)
            .flatMap((row): Array<SimilarWord> => {
              const similar = similarEntries.get(row.similarId)
              if (similar === undefined) return []
              return [
                {
                  entryId: EntryId.make(similar.id),
                  headword: similar.headword,
                  reading: similar.reading,
                  meaning: similarMeaning(sense, similar),
                  difference: row.difference,
                  confidence: row.confidence,
                  formality: similarFormality.get(similar.id) ?? null
                }
              ]
            }),
          examples: examples
            .filter((example) => example.sense === index)
            .map((example) => toExample(example, exampleAudio))
        }))

        return {
          id: EntryId.make(entry.id),
          language: entry.language,
          headword: entry.headword,
          reading: entry.reading,
          romaji: entry.language === "ja" ? romanize(entry.reading) : "",
          common: entry.common,
          forms: entry.forms
            .filter((form) => !form.tags.includes("sK") && !form.tags.includes("sk"))
            .map((form) => ({ text: form.text, kind: form.kind, common: form.common, tags: form.tags.map(tag) })),
          senses,
          audioUrl: headwordClips[0] === undefined ? null : audioUrl(headwordClips[0].key),
          audio: headwordClips.map((clip) => ({
            url: audioUrl(clip.key),
            voice: clip.voice,
            voiceName: voiceName(clip.voice)
          })),
          loan:
            loan?.word == null || loan.verdict === null
              ? null
              : { word: loan.word, verdict: loan.verdict, trap: loan.trap },
          enrichment: yield* enrichmentFor(entry, true)
        } satisfies Entry
      })

      const entry = Effect.fn("Dictionary.entry")(function* (id: EntryId) {
        const [record] = yield* getEntries(db, [id])
        return record === undefined ? Option.none() : Option.some(yield* assemble(record))
      })

      const requestEnrichment = Effect.fn("Dictionary.requestEnrichment")(function* (id: EntryId) {
        const [record] = yield* getEntries(db, [id])
        return record === undefined ? Option.none() : Option.some(yield* enrichmentFor(record, true))
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

      return Dictionary.of({ search, entry, requestEnrichment, lookupWords })
    })
  )
}
