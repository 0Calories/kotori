import { Database } from "@kotori/db"
import { entries, forms, glosses, senses } from "@kotori/db/schema"
import { EntryId, type EntrySummary, type SearchResult } from "@kotori/domain"
import {
  deinflect,
  hasJapanese,
  katakanaToHiragana,
  matchesPartOfSpeech,
  romajiToKana,
  romanize
} from "@kotori/japanese"
import { and, desc, eq, max, min, sql } from "drizzle-orm"
import { Effect } from "effect"
import { nuanceFor } from "../enrichment/nuance.ts"
import { findForms, firstGlosses, getEntries, normalizeGloss, ranks } from "./entries.ts"

interface Hit {
  readonly entryId: number
  readonly score: number
  readonly inflection: ReadonlyArray<string>
}

const keepBest = (hits: Iterable<Hit>) => {
  const best = new Map<number, Hit>()
  for (const hit of hits) {
    const current = best.get(hit.entryId)
    if (current === undefined || hit.score > current.score) best.set(hit.entryId, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

const unique = <A>(items: Iterable<A>) => [...new Set(items)]

const SENSE_BONUS = [40, 25, 15, 10, 5]

/** Usage tags that make a word a less likely answer to a plain English query. */
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

/** An FTS5 expression requiring every word of the query, each quoted so user input can't be parsed as syntax. */
const ftsExpression = (query: string) => {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length === 0 ? null : words.map((word) => `"${word}"`).join(" ")
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// A range scan on the bytewise-collated text, so the index serves it.
const findFormPrefix = Effect.fn("dictionary.findFormPrefix")(function* (prefix: string, limit: number) {
  const db = yield* Database
  const rows = yield* db
    .select({ id: forms.entryId })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(sql`${forms.text} >= ${prefix} AND ${forms.text} < ${prefix + "\u{10FFFF}"}`)
    .groupBy(forms.entryId)
    .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)), min(sql`length(${forms.text})`))
    .limit(limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

const glossMatch = {
  entryId: glosses.entryId,
  sense: glosses.sense,
  position: glosses.position,
  text: glosses.text,
  /** How many glosses the matched sense has; a lone gloss is a more specific match. */
  glossCount: sql<number>`(
    SELECT count(*) FROM ${glosses} AS g2
    WHERE g2.entry_id = ${glosses.entryId} AND g2.sense = ${glosses.sense}
  )`.mapWith(Number),
  misc: senses.misc
}

interface GlossMatch {
  readonly entryId: number
  readonly sense: number
  readonly position: number
  readonly text: string
  readonly glossCount: number
  readonly misc: ReadonlyArray<string>
  /** Ascending: more negative is a better match (negated `ts_rank`, 0 for exact matches). */
  readonly rank: number
}

/** Full-text search over English glosses; every word of the plain-text query must match. */
const searchGlosses = Effect.fn("dictionary.searchGlosses")(function* (query: string, limit: number) {
  const db = yield* Database
  const tsquery = sql`plainto_tsquery('english', ${query})`
  // `rank` is negated ts_rank so it keeps the old FTS5 bm25 shape: ascending, more negative = better.
  const rows: ReadonlyArray<GlossMatch> = yield* db
    .select({ ...glossMatch, rank: sql<number>`-ts_rank(${glosses.document}, ${tsquery})`.mapWith(Number) })
    .from(glosses)
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(sql`${glosses.document} @@ ${tsquery}`)
    .orderBy(sql`-ts_rank(${glosses.document}, ${tsquery})`)
    .limit(limit)
  return rows
}, Effect.orDie)

/** Glosses whose normalised text equals `normalizeGloss(query)`. */
const findGlossesExact = Effect.fn("dictionary.findGlossesExact")(function* (query: string, limit: number) {
  const norm = normalizeGloss(query)
  if (norm.length === 0) return []
  const db = yield* Database
  const rows: ReadonlyArray<GlossMatch> = yield* db
    .select({ ...glossMatch, rank: sql<number>`0`.mapWith(Number) })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(eq(glosses.norm, norm))
    .orderBy(desc(entries.common), desc(entries.priority))
    .limit(limit)
  return rows
}, Effect.orDie)

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const japaneseHits = Effect.fnUntraced(function* (query: string) {
  const variants = unique([query, katakanaToHiragana(query)])
  const candidates = variants.flatMap(deinflect)
  const matches = yield* findForms(unique(candidates.map((candidate) => candidate.term)))
  const found = new Map((yield* getEntries(unique(matches.map((m) => m.entryId)))).map((e) => [e.id, e]))

  const exact = matches.flatMap((match): Array<Hit> => {
    const entry = found.get(match.entryId)
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

  const prefixIds = yield* findFormPrefix(query, 40)
  const prefixRanks = yield* ranks(prefixIds)
  const prefix = prefixIds.map((entryId, index): Hit => ({
    entryId,
    score: 400 - index + (prefixRanks.get(entryId)?.common ? 50 : 0),
    inflection: []
  }))
  return keepBest([...exact, ...prefix])
})

const englishHits = Effect.fnUntraced(function* (query: string) {
  const expression = ftsExpression(query)
  const exact = yield* findGlossesExact(query, 300)
  const fuzzy = expression === null ? [] : yield* searchGlosses(expression, 600)
  const norm = normalizeGloss(query)
  const matchRanks = yield* ranks(unique([...exact, ...fuzzy].map((match) => match.entryId)))

  const score = (match: GlossMatch, isExact: boolean): Hit => {
    const rank = matchRanks.get(match.entryId)
    const glossNorm = normalizeGloss(match.text)
    return {
      entryId: match.entryId,
      score:
        (isExact ? 100 : 30) +
        (!isExact && glossNorm.startsWith(norm) ? 15 : 0) +
        (SENSE_BONUS[match.sense] ?? 0) -
        3 * match.position -
        4 * Math.min(match.glossCount - 1, 5) -
        tagPenalty(match.misc) +
        Math.min(10, -match.rank) +
        (rank?.common ? 30 : 0) +
        (rank?.priority ?? 0) / 5,
      inflection: []
    }
  }
  return keepBest([...exact.map((m) => score(m, true)), ...fuzzy.map((m) => score(m, false))])
})

const summaries = Effect.fnUntraced(function* (hits: ReadonlyArray<Hit>) {
  const ids = hits.map((hit) => hit.entryId)
  const found = new Map((yield* getEntries(ids)).map((entry) => [entry.id, entry]))
  const formality = new Map(
    (yield* nuanceFor(ids)).filter((row) => row.sense === 0).map((row) => [row.entryId, row.nuance.formality.value])
  )
  return hits.flatMap((hit): Array<EntrySummary> => {
    const entry = found.get(hit.entryId)
    if (entry === undefined) return []
    return [
      {
        id: EntryId.make(entry.id),
        headword: entry.headword,
        reading: entry.reading,
        romaji: romanize(entry.reading),
        common: entry.common,
        meanings: firstGlosses(entry, 3),
        partOfSpeech: entry.senses[0]?.pos[0] ?? null,
        formality: formality.get(entry.id) ?? null,
        inflection: hit.inflection
      }
    ]
  })
})

/** Searches in Japanese (conjugated forms too), English, or rōmaji, whichever the query looks like. */
export const search = Effect.fn("dictionary.search")(function* (raw: string, limit: number) {
  const query = raw.normalize("NFKC").trim()
  if (query.length === 0) return { query, mode: "english", reading: null, entries: [] } satisfies SearchResult

  if (hasJapanese(query)) {
    const hits = yield* japaneseHits(query)
    return {
      query,
      mode: "japanese",
      reading: null,
      entries: yield* summaries(hits.slice(0, limit))
    } satisfies SearchResult
  }

  const english = yield* englishHits(query)
  const kana = romajiToKana(query)
  const romaji = kana === null ? [] : (yield* japaneseHits(kana)).filter((hit) => hit.score >= 700)
  const englishIsStrong = (english[0]?.score ?? 0) >= 150
  const preferRomaji = romaji.length > 0 && !englishIsStrong
  const ordered = preferRomaji
    ? keepBest([...romaji, ...english.map((h) => ({ ...h, score: h.score - 1000 }))])
    : [...english, ...romaji.filter((hit) => !english.some((e) => e.entryId === hit.entryId))]
  return {
    query,
    mode: preferRomaji ? "romaji" : "english",
    reading: preferRomaji ? kana : null,
    entries: yield* summaries(ordered.slice(0, limit))
  } satisfies SearchResult
})

/** Entry ids for words, for linking coach vocabulary to the dictionary. */
export const lookupWords = Effect.fn("dictionary.lookupWords")(function* (
  words: ReadonlyArray<{ readonly word: string; readonly reading: string }>
) {
  const matches = yield* findForms(unique(words.flatMap((w) => [w.word, w.reading])))
  const matchRanks = yield* ranks(unique(matches.map((m) => m.entryId)))
  return words.map(({ word, reading }) => {
    const candidates = matches.filter((m) => m.text === word || m.text === reading)
    // Prefer an entry matching both spelling and reading, then the most frequent.
    const best = candidates
      .map((m) => ({
        id: m.entryId,
        score:
          (candidates.filter((c) => c.entryId === m.entryId).length > 1 ? 1000 : 0) +
          (m.text === word ? 100 : 0) +
          (matchRanks.get(m.entryId)?.priority ?? 0)
      }))
      .sort((a, b) => b.score - a.score)[0]
    return best === undefined ? null : EntryId.make(best.id)
  })
})
