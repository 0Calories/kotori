import type { Language } from "@kotori/contracts"
import { entries, type EntryId, glosses, labels, labelSeverity, loanLinks, MAX_PITFALLS, pitfalls } from "@kotori/db"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Console, Effect } from "effect"
import { chunks } from "../../../db/chunks.ts"
import { type DatabaseShape, rawRows } from "../../../db/Database.ts"
import { findForms } from "../queries.ts"
import { ARTIFACTS, FormLine, LoanLine, PitfallLine, readArtifact } from "./artifacts.ts"

/**
 * The import's half of the offline passes: reads each committed artifact, if there is one, and
 * fills only the cells the dictionary left empty. Re-running it with the same files changes
 * nothing. Approved Ask Kotori words are never touched: their labels and pitfalls are the approved
 * files'. Runs after the dictionaries are imported, so every sense it names is in place.
 */

/** The judged entries that are still the words judged: same language and headword, not approved. */
const stillJudged = Effect.fnUntraced(function* (
  db: DatabaseShape,
  language: Language,
  lines: ReadonlyArray<{ readonly entryId: number; readonly headword: string }>
) {
  const found = new Set<EntryId>()
  const wanted = new Map(lines.map((line) => [line.entryId, line.headword]))
  for (const chunk of chunks([...wanted.keys()], 5000)) {
    const rows = yield* db
      .select({
        id: entries.id,
        headword: entries.headword,
        language: entries.language,
        dictionary: entries.dictionary
      })
      .from(entries)
      .where(inArray(entries.id, chunk as Array<EntryId>))
      .pipe(Effect.orDie)
    for (const row of rows) {
      if (row.language === language && row.dictionary !== "kotori" && wanted.get(row.id) === row.headword) {
        found.add(row.id)
      }
    }
  }
  return found
})

/** Each entry's senses by their first gloss, so a judgment follows its sense when senses move. */
const sensesByGloss = Effect.fnUntraced(function* (db: DatabaseShape, ids: ReadonlyArray<EntryId>) {
  const found = new Map<EntryId, Map<string, number>>()
  for (const chunk of chunks(ids, 5000)) {
    const rows = yield* db
      .select({ entryId: glosses.entryId, sense: glosses.sense, text: glosses.text })
      .from(glosses)
      .where(and(inArray(glosses.entryId, [...chunk]), eq(glosses.position, 0)))
      .orderBy(asc(glosses.entryId), asc(glosses.sense))
      .pipe(Effect.orDie)
    for (const row of rows) {
      const bySense = found.get(row.entryId) ?? new Map<string, number>()
      found.set(row.entryId, bySense)
      if (!bySense.has(row.text)) bySense.set(row.text, row.sense)
    }
  }
  return found
})

/**
 * Kotori's `form` labels from `data/labels/ja-form.jsonl`: on each judged sense that still carries
 * no label but quiet ones from another source. Kotori's earlier `form` labels on the file's words
 * are replaced, so the file decides.
 */
export const applyFormLabels = Effect.fn("passes.applyFormLabels")(function* (
  db: DatabaseShape,
  lines: ReadonlyArray<FormLine>
) {
  const valid = yield* stillJudged(db, "ja", lines)
  const ids = [...valid]
  const bySense = yield* sensesByGloss(db, ids)
  const rows: Array<typeof labels.$inferInsert> = []
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const existing = new Map<string, Array<string>>()
        for (const chunk of chunks(ids, 5000)) {
          yield* tx
            .delete(labels)
            .where(and(inArray(labels.entryId, [...chunk]), eq(labels.code, "form"), eq(labels.source, "kotori")))
          for (const row of yield* tx
            .select({ entryId: labels.entryId, sense: labels.sense, code: labels.code })
            .from(labels)
            .where(inArray(labels.entryId, [...chunk]))) {
            const key = `${row.entryId}:${row.sense}`
            existing.set(key, [...(existing.get(key) ?? []), row.code])
          }
        }
        for (const line of lines) {
          const entryId = line.entryId as EntryId
          if (!valid.has(entryId)) continue
          for (const { gloss } of line.form) {
            const sense = bySense.get(entryId)?.get(gloss)
            if (sense === undefined) continue
            // Fill only what is empty: a register label from the dictionary says it already.
            const codes = existing.get(`${entryId}:${sense}`) ?? []
            if (!codes.every((code) => code !== "form" && labelSeverity(code as never) === "quiet")) continue
            rows.push({ entryId, sense, code: "form", source: "kotori" })
          }
        }
        for (const chunk of chunks(rows, 5000))
          yield* tx
            .insert(labels)
            .values([...chunk])
            .onConflictDoNothing()
      })
    )
    .pipe(Effect.orDie)
  return rows.length
})

/** Entries written exactly as `texts`, inflections aside, by text: a word names one only when one matches. */
const wordsNamed = Effect.fnUntraced(function* (db: DatabaseShape, texts: ReadonlyArray<string>, language: Language) {
  const key = (text: string) => (language === "en" ? text.toLowerCase() : text)
  const owners = new Map<string, Set<EntryId>>()
  for (const chunk of chunks([...new Set(texts)], 2000)) {
    for (const form of yield* findForms(db, [...chunk], language)) {
      if (form.kind === "inflection") continue
      const owned = owners.get(key(form.text)) ?? new Set<EntryId>()
      owned.add(form.entryId)
      owners.set(key(form.text), owned)
    }
  }
  return (text: string): EntryId | null => {
    const owned = owners.get(key(text))
    return owned !== undefined && owned.size === 1 ? [...owned][0]! : null
  }
})

/**
 * Kotori's pitfalls from `data/pitfalls/{ja,en}.jsonl`, replacing Kotori's earlier ones on the
 * file's words (none are anyone else's: approved words are skipped) and taking only the ranks other
 * sources leave free, so the cap holds. A pitfall about a sense no longer there is left out.
 */
export const applyPitfalls = Effect.fn("passes.applyPitfalls")(function* (
  db: DatabaseShape,
  language: Language,
  lines: ReadonlyArray<PitfallLine>
) {
  const valid = yield* stillJudged(db, language, lines)
  const ids = [...valid]
  const bySense = yield* sensesByGloss(db, ids)
  const named = yield* wordsNamed(
    db,
    lines.flatMap((line) => line.pitfalls.flatMap((pitfall) => (pitfall.about === null ? [] : [pitfall.about]))),
    language
  )
  let written = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const taken = new Map<EntryId, Set<number>>()
        for (const chunk of chunks(ids, 5000)) {
          yield* tx.delete(pitfalls).where(and(inArray(pitfalls.entryId, [...chunk]), eq(pitfalls.source, "kotori")))
          for (const row of yield* tx
            .select({ entryId: pitfalls.entryId, rank: pitfalls.rank })
            .from(pitfalls)
            .where(inArray(pitfalls.entryId, [...chunk]))) {
            taken.set(row.entryId, (taken.get(row.entryId) ?? new Set()).add(row.rank))
          }
        }
        const rows: Array<typeof pitfalls.$inferInsert> = []
        for (const line of lines) {
          const entryId = line.entryId as EntryId
          if (!valid.has(entryId)) continue
          const free = Array.from({ length: MAX_PITFALLS }, (_, index) => index + 1).filter(
            (rank) => !taken.get(entryId)?.has(rank)
          )
          const placed = line.pitfalls.flatMap((pitfall) => {
            const sense = pitfall.sense === null ? null : bySense.get(entryId)?.get(pitfall.sense)
            if (sense === undefined) return []
            const about = pitfall.about === null ? null : named(pitfall.about)
            return [
              { entryId, sense, kind: pitfall.kind, text: pitfall.text, aboutEntryId: about, source: "kotori" as const }
            ]
          })
          rows.push(...placed.slice(0, free.length).map((row, index) => ({ ...row, rank: free[index]! })))
        }
        for (const chunk of chunks(rows, 2000)) yield* tx.insert(pitfalls).values([...chunk])
        written = rows.length
      })
    )
    .pipe(Effect.orDie)
  return written
})

/**
 * Kotori's loan verdicts from `data/loans/verdicts.jsonl`: each sets `meaning` on its pair, with
 * source `kotori`, adding the pair where JMdict doesn't name it. A meaning already set by another
 * source is kept; Kotori's own is replaced, so the file decides. A verdict-less line adds nothing.
 */
export const applyLoanVerdicts = Effect.fn("passes.applyLoanVerdicts")(function* (
  db: DatabaseShape,
  lines: ReadonlyArray<LoanLine>
) {
  const verdicts = lines.filter(
    (line): line is LoanLine & { katakana: string; meaning: "same" | "divergent" } =>
      line.katakana !== null && line.meaning !== null
  )
  if (verdicts.length === 0) return 0
  // An id names its entry only while that entry is still the word: ids are stable, words may go.
  const ids = [
    ...new Set(verdicts.flatMap((line) => [line.englishId, ...(line.katakanaId === null ? [] : [line.katakanaId])]))
  ]
  const stored = new Map<number, { readonly headword: string; readonly language: Language }>()
  for (const chunk of chunks(ids, 5000)) {
    const rows = yield* db
      .select({ id: entries.id, headword: entries.headword, language: entries.language })
      .from(entries)
      .where(inArray(entries.id, chunk as Array<EntryId>))
      .pipe(Effect.orDie)
    for (const row of rows) stored.set(row.id, row)
  }
  const entryFor = (id: number | null, word: string, language: Language) => {
    const row = id === null ? undefined : stored.get(id)
    return row !== undefined && row.language === language && row.headword === word ? (id as EntryId) : null
  }
  let written = 0
  for (const chunk of chunks(verdicts, 1000)) {
    const values = sql.join(
      chunk.map(
        (line) =>
          sql`(${line.katakana}, ${entryFor(line.katakanaId, line.katakana, "ja")}::integer, ${line.english}, ${entryFor(line.englishId, line.english, "en")}::integer, ${line.meaning}::loan_meaning)`
      ),
      sql`, `
    )
    const result = yield* rawRows(
      db,
      sql`
          INSERT INTO ${loanLinks} (katakana, katakana_entry_id, english, english_entry_id, meaning, source)
          SELECT katakana, katakana_entry_id, english, english_entry_id, meaning, 'kotori'
          FROM (VALUES ${values}) AS v(katakana, katakana_entry_id, english, english_entry_id, meaning)
          ON CONFLICT (katakana, english) DO UPDATE
          SET meaning = excluded.meaning,
              source = 'kotori',
              katakana_entry_id = coalesce(${loanLinks}.katakana_entry_id, excluded.katakana_entry_id),
              english_entry_id = coalesce(${loanLinks}.english_entry_id, excluded.english_entry_id)
          WHERE (${loanLinks}.meaning IS NULL OR ${loanLinks}.source = 'kotori')
            AND (${loanLinks}.meaning, ${loanLinks}.source) IS DISTINCT FROM (excluded.meaning, 'kotori')
          RETURNING 1
        `
    ).pipe(Effect.orDie)
    written += result.length
  }
  return written
})

/**
 * Applies every artifact present, in an order that needs both dictionaries for loans, and says
 * what each filled. Called by `kotori seed` after its imports.
 */
export const applyArtifacts = Effect.fn("passes.applyArtifacts")(function* (db: DatabaseShape) {
  const form = yield* readArtifact(ARTIFACTS["ja-form"], FormLine)
  if (form !== null) {
    const filled = yield* applyFormLabels(db, form.lines)
    yield* Console.log(`Applied ${ARTIFACTS["ja-form"]}: ${filled.toLocaleString()} form labels.`)
  }
  for (const language of ["ja", "en"] as const) {
    const path = ARTIFACTS[`pitfalls-${language}`]
    const file = yield* readArtifact(path, PitfallLine)
    if (file === null) continue
    const written = yield* applyPitfalls(db, language, file.lines)
    yield* Console.log(`Applied ${path}: ${written.toLocaleString()} pitfalls.`)
  }
  const loans = yield* readArtifact(ARTIFACTS.loans, LoanLine)
  if (loans !== null) {
    const set = yield* applyLoanVerdicts(db, loans.lines)
    yield* Console.log(`Applied ${ARTIFACTS.loans}: ${set.toLocaleString()} loan verdicts changed.`)
  }
})
