import type { LoanCandidate, WordToJudge } from "@kotori/ai"
import { loanSenseLine } from "@kotori/ai"
import type { EntryRecord, Language } from "@kotori/contracts"
import { entries, type EntryId, glosses, labels, labelSeverity, loanLinks, patterns, senses } from "@kotori/db"
import { normalizeGloss } from "@kotori/language"
import { and, asc, desc, eq, gt, inArray, isNotNull, ne, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import { chunks } from "../../../db/chunks.ts"
import type { DatabaseShape } from "../../../db/Database.ts"
import { getEntries, tagLabels } from "../queries.ts"

/**
 * What the offline passes judge, read from the database: dictionary words (never approved Ask
 * Kotori words, whose pitfalls and labels come from the approved files), with what their entry page
 * already shows, so a pass fills only empty cells.
 */

/** Senses shown to Claude per word: later ones rarely matter, and long entries would crowd a batch. */
export const PITFALL_SENSES = 10

/** Senses of a word Jev is asked about for `form`. */
export const FORM_SENSES = 6

/** A word written in katakana alone, as loanwords are (スタイル, コーヒー); valid in JavaScript and Postgres. */
export const KATAKANA_WORD = "^[゠-ヿ]+$"

export interface PassQuery {
  readonly language: Language
  /** Only words the dictionary marks common; off, every word. */
  readonly commonOnly: boolean
  /** Entries already judged, skipped. */
  readonly judged: ReadonlySet<number>
  readonly limit: number
}

/**
 * Entries a pass may judge, most used first, in pages: one language, not approved Ask Kotori words
 * (`dictionary = 'kotori'`), and not already judged. `keep` filters each page, so the limit counts
 * the words actually judged.
 */
const pickEntries = Effect.fnUntraced(function* <T>(
  db: DatabaseShape,
  query: PassQuery,
  keep: (records: ReadonlyArray<EntryRecord>) => Effect.Effect<ReadonlyArray<T>>
) {
  const picked: Array<T> = []
  let after: { readonly priority: number; readonly id: EntryId } | null = null
  while (picked.length < query.limit) {
    const page: ReadonlyArray<{ readonly id: EntryId; readonly priority: number }> = yield* db
      .select({ id: entries.id, priority: entries.priority })
      .from(entries)
      .where(
        and(
          eq(entries.language, query.language),
          ne(entries.dictionary, "kotori"),
          query.commonOnly ? eq(entries.common, true) : undefined,
          after === null
            ? undefined
            : or(
                sql`${entries.priority} < ${after.priority}`,
                and(eq(entries.priority, after.priority), gt(entries.id, after.id))
              )
        )
      )
      .orderBy(desc(entries.priority), asc(entries.id))
      .limit(1000)
      .pipe(Effect.orDie)
    if (page.length === 0) break
    after = page.at(-1)!
    const ids = page.map((row) => row.id).filter((id) => !query.judged.has(id))
    const kept = yield* keep(yield* getEntries(db, ids))
    picked.push(...kept.slice(0, query.limit - picked.length))
  }
  return picked
})

/** Each entry's label codes by sense, from every source. */
const labelCodes = Effect.fnUntraced(function* (db: DatabaseShape, ids: ReadonlyArray<EntryId>) {
  const found = new Map<EntryId, Map<number, Array<string>>>()
  for (const chunk of chunks(ids, 5000)) {
    const rows = yield* db
      .select({ entryId: labels.entryId, sense: labels.sense, code: labels.code })
      .from(labels)
      .where(inArray(labels.entryId, [...chunk]))
      .orderBy(asc(labels.entryId), asc(labels.sense), asc(labels.code))
      .pipe(Effect.orDie)
    for (const row of rows) {
      const bySense = found.get(row.entryId) ?? new Map<number, Array<string>>()
      found.set(row.entryId, bySense)
      bySense.set(row.sense, [...(bySense.get(row.sense) ?? []), row.code])
    }
  }
  return found
})

/** Each entry's usage notes (patterns) by sense, in order. */
const notesOf = Effect.fnUntraced(function* (db: DatabaseShape, ids: ReadonlyArray<EntryId>) {
  const found = new Map<EntryId, Map<number, Array<string>>>()
  for (const chunk of chunks(ids, 5000)) {
    const rows = yield* db
      .select({ entryId: patterns.entryId, sense: patterns.sense, text: patterns.text })
      .from(patterns)
      .where(inArray(patterns.entryId, [...chunk]))
      .orderBy(asc(patterns.entryId), asc(patterns.sense), asc(patterns.position))
      .pipe(Effect.orDie)
    for (const row of rows) {
      const bySense = found.get(row.entryId) ?? new Map<number, Array<string>>()
      found.set(row.entryId, bySense)
      bySense.set(row.sense, [...(bySense.get(row.sense) ?? []), row.text])
    }
  }
  return found
})

/** The word as a model is shown it: its senses with their labels and notes. */
export const wordToJudge = (
  entry: EntryRecord,
  labelsBySense: ReadonlyMap<number, ReadonlyArray<string>> | undefined,
  notesBySense: ReadonlyMap<number, ReadonlyArray<string>> | undefined,
  senseLimit: number
): WordToJudge => ({
  headword: entry.headword,
  reading: entry.reading,
  senses: entry.senses.slice(0, senseLimit).map((sense, position) => ({
    glosses: sense.glosses.map((gloss) => gloss.text),
    pos: sense.pos,
    labels: labelsBySense?.get(position) ?? [],
    notes: notesBySense?.get(position) ?? []
  }))
})

/** A sense the form pass may ask about: one with no label but quiet ones (no register, no `form`). */
const unmarked = (codes: ReadonlyArray<string> | undefined) =>
  (codes ?? []).every((code) => code !== "form" && labelSeverity(code as never) === "quiet")

export interface FormCandidate {
  readonly entryId: EntryId
  readonly word: WordToJudge
  /** Positions of the senses to ask about. */
  readonly senses: ReadonlyArray<number>
}

/** Japanese words with a sense whose register the dictionary leaves unsaid; see `unmarked`. */
export const formCandidates = Effect.fn("passes.formCandidates")(function* (
  db: DatabaseShape,
  query: Omit<PassQuery, "language">
) {
  return yield* pickEntries(db, { ...query, language: "ja" }, (records) =>
    Effect.gen(function* () {
      const codes = yield* labelCodes(
        db,
        records.map((entry) => entry.id)
      )
      return records.flatMap((entry): Array<FormCandidate> => {
        const bySense = codes.get(entry.id)
        const asked = entry.senses
          .slice(0, FORM_SENSES)
          .flatMap((sense, position) =>
            sense.glosses.length > 0 && unmarked(bySense?.get(position)) ? [position] : []
          )
        return asked.length === 0
          ? []
          : [{ entryId: entry.id, word: wordToJudge(entry, bySense, undefined, FORM_SENSES), senses: asked }]
      })
    })
  )
})

export interface PitfallCandidate {
  readonly entryId: EntryId
  readonly word: WordToJudge
}

/** The loan links read from each entry's end, with a verdict first, and the other word's glosses. */
const loansOf = Effect.fnUntraced(function* (db: DatabaseShape, language: Language, ids: ReadonlyArray<EntryId>) {
  const found = new Map<EntryId, NonNullable<WordToJudge["loan"]>>()
  if (ids.length === 0) return found
  const own = language === "en" ? loanLinks.englishEntryId : loanLinks.katakanaEntryId
  const other = language === "en" ? loanLinks.katakanaEntryId : loanLinks.englishEntryId
  const rows = yield* db
    .select({
      entryId: own,
      otherId: other,
      katakana: loanLinks.katakana,
      english: loanLinks.english,
      meaning: loanLinks.meaning
    })
    .from(loanLinks)
    .where(inArray(own, [...ids]))
    .orderBy(sql`${loanLinks.meaning} IS NULL`, asc(loanLinks.id))
    .pipe(Effect.orDie)
  const otherIds = [...new Set(rows.flatMap((row) => (row.otherId === null ? [] : [row.otherId])))]
  const glossRows =
    otherIds.length === 0
      ? []
      : yield* db
          .select({ entryId: glosses.entryId, text: glosses.text })
          .from(glosses)
          .where(and(inArray(glosses.entryId, otherIds), sql`${glosses.sense} < 3`))
          .orderBy(asc(glosses.entryId), asc(glosses.sense), asc(glosses.position))
          .pipe(Effect.orDie)
  for (const row of rows) {
    if (row.entryId === null || found.has(row.entryId)) continue
    found.set(row.entryId, {
      word: language === "en" ? row.katakana : row.english,
      meaning: row.meaning,
      glosses: glossRows.filter((gloss) => gloss.entryId === row.otherId).map((gloss) => gloss.text)
    })
  }
  return found
})

/** Words of one language to write pitfalls for, as their pages show them. */
export const pitfallCandidates = Effect.fn("passes.pitfallCandidates")(function* (db: DatabaseShape, query: PassQuery) {
  return yield* pickEntries(db, query, (records) =>
    Effect.gen(function* () {
      const ids = records.map((entry) => entry.id)
      const [codes, notes, loans] = yield* Effect.all([
        labelCodes(db, ids),
        notesOf(db, ids),
        loansOf(db, query.language, ids)
      ])
      return records.map((entry): PitfallCandidate => ({
        entryId: entry.id,
        word: {
          ...wordToJudge(entry, codes.get(entry.id), notes.get(entry.id), PITFALL_SENSES),
          loan: loans.get(entry.id) ?? null
        }
      }))
    })
  )
})

/** A katakana word that may be the loan of an English word, and how the dictionary ties them. */
interface FoundLoan {
  readonly word: string
  readonly entryId: EntryId
  readonly by: LoanCandidate["by"]
  readonly priority: number
}

/**
 * Common katakana words that may be the loanword of each English word: entries with the word as
 * a gloss, or whose JMdict source (`lsource`) it is; a source first, then the most used, at most
 * `limit` per word (restored from before Phase 7, where the nuance job asked the same).
 */
export const loanCandidates = Effect.fn("dictionary.loanCandidates")(function* (
  db: DatabaseShape,
  words: ReadonlyArray<string>,
  limit: number
) {
  const wanted = [...new Set(words.map(normalizeGloss))].filter((word) => word.length > 1)
  const found = new Map<string, Map<EntryId, FoundLoan>>()
  if (wanted.length === 0) return found
  const katakana = and(
    eq(entries.language, "ja"),
    eq(entries.common, true),
    sql`${entries.headword} ~ ${KATAKANA_WORD}`
  )
  const add = (row: FoundLoan) => {
    const forWord = found.get(row.word) ?? new Map<EntryId, FoundLoan>()
    if (row.by === "source" || !forWord.has(row.entryId)) forWord.set(row.entryId, row)
    found.set(row.word, forWord)
  }
  for (const chunk of chunks(wanted, 2000)) {
    const byGloss = yield* db
      .selectDistinct({ word: glosses.norm, entryId: glosses.entryId, priority: entries.priority })
      .from(glosses)
      .innerJoin(entries, eq(entries.id, glosses.entryId))
      .where(and(inArray(glosses.norm, [...chunk]), katakana))
      .pipe(Effect.orDie)
    for (const row of byGloss) add({ ...row, by: "gloss" })
    // Sources are matched loosely here and exactly below, as `normalizeGloss` matches glosses.
    const listed = sql.join(
      chunk.map((word) => sql`${word}`),
      sql`, `
    )
    const bySource = yield* db
      .select({ entryId: senses.entryId, sources: senses.sources, priority: entries.priority })
      .from(senses)
      .innerJoin(entries, eq(entries.id, senses.entryId))
      .where(
        and(
          katakana,
          isNotNull(senses.sources),
          sql`EXISTS (SELECT 1 FROM unnest(${senses.sources}) AS source WHERE lower(source) IN (${listed}))`
        )
      )
      .pipe(Effect.orDie)
    const set = new Set(chunk)
    for (const row of bySource) {
      for (const source of row.sources ?? []) {
        const word = normalizeGloss(source)
        if (set.has(word)) add({ word, entryId: row.entryId, by: "source", priority: row.priority })
      }
    }
  }
  for (const [word, forWord] of found) {
    const ranked = [...forWord.values()]
      .sort(
        (a, b) =>
          Number(b.by === "source") - Number(a.by === "source") || b.priority - a.priority || a.entryId - b.entryId
      )
      .slice(0, limit)
    found.set(word, new Map(ranked.map((row) => [row.entryId, row])))
  }
  return found
})

export interface LoanCandidateWord {
  readonly entryId: EntryId
  readonly english: string
  readonly candidates: ReadonlyArray<LoanCandidate & { readonly entryId: EntryId }>
}

/**
 * English words whose loan has no verdict yet, with their katakana candidates: the pairs JMdict
 * names (`lsource`), then gloss matches. A word with a verdict already, from any source, is
 * skipped; one with no candidate isn't asked about.
 */
export const loanCandidateWords = Effect.fn("passes.loanCandidateWords")(function* (
  db: DatabaseShape,
  query: Omit<PassQuery, "language">,
  limit: number
) {
  const tags = yield* tagLabels(db)
  return yield* pickEntries(db, { ...query, language: "en" }, (records) =>
    Effect.gen(function* () {
      const ids = records.map((entry) => entry.id)
      const links =
        ids.length === 0
          ? []
          : yield* db
              .select({ englishId: loanLinks.englishEntryId, meaning: loanLinks.meaning })
              .from(loanLinks)
              .where(inArray(loanLinks.englishEntryId, ids))
              .pipe(Effect.orDie)
      const decided = new Set(links.flatMap((link) => (link.meaning !== null ? [link.englishId] : [])))
      const open = records.filter((entry) => !decided.has(entry.id))
      const found = yield* loanCandidates(
        db,
        open.map((entry) => entry.headword),
        limit
      )
      const katakanaIds = [...new Set([...found.values()].flatMap((forWord) => [...forWord.keys()]))]
      const katakana = new Map((yield* getEntries(db, katakanaIds)).map((entry) => [entry.id, entry]))
      return open.flatMap((entry): Array<LoanCandidateWord> => {
        const forWord = found.get(normalizeGloss(entry.headword))
        const candidates = [...(forWord?.values() ?? [])].flatMap((row) => {
          const candidate = katakana.get(row.entryId)
          if (candidate === undefined) return []
          return [
            {
              entryId: candidate.id,
              katakana: candidate.headword,
              by: row.by,
              wasei: candidate.senses.some((sense) => sense.wasei),
              meanings: candidate.senses.map((sense) =>
                loanSenseLine(
                  sense.glosses.map((gloss) => gloss.text),
                  [...sense.misc, ...sense.fields].map((code) => tags.get(code) ?? code)
                )
              )
            }
          ]
        })
        return candidates.length === 0 ? [] : [{ entryId: entry.id, english: entry.headword, candidates }]
      })
    })
  )
})
