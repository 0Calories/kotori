import type { LabelCode, Language } from "@kotori/contracts"
import {
  cautions,
  entries,
  type EntryId,
  glosses,
  labels,
  type LoanLinkMeaning,
  loanLinks,
  MAX_CAUTIONS
} from "@kotori/db"
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { Console, Effect } from "effect"
import { chunks } from "../../../db/chunks.ts"
import type { DatabaseShape } from "../../../db/Database.ts"
import { findForms } from "../queries.ts"
import { ARTIFACTS, CautionLine, FormalLabelLine, LoanLine, type Pass, readArtifact } from "./artifacts.ts"
import { registerUnsaid } from "./candidates.ts"

/**
 * The import's half of the offline passes: reads each committed artifact, if there is one, and
 * fills only the cells the dictionary left empty. Each file decides what its pass gave: what it
 * no longer covers (a trimmed or reverted file, a word that changed) is removed, and all of it
 * when the file is gone, so a bad pass is a `git revert` and a reseed. Re-running it with the same
 * files changes nothing. Approved Ask Kotori words are never touched: their labels and cautions
 * are the approved files'. Runs after the dictionaries are imported, so every sense it names is in
 * place.
 */

/** What applying one file did: rows written, and words (or loan pairs) whose earlier rows it removed. */
export interface Applied {
  readonly written: number
  readonly removed: number
}

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
        source: entries.source
      })
      .from(entries)
      .where(inArray(entries.id, chunk as Array<EntryId>))
      .pipe(Effect.orDie)
    for (const row of rows) {
      if (row.language === language && row.source !== "kotori" && wanted.get(row.id) === row.headword) {
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
 * no label but quiet ones from another source. Kotori's earlier `form` labels on dictionary words
 * are replaced, those on words the file doesn't name removed, so the file decides. Nothing else
 * writes a Kotori `form` label on a dictionary word: an approved word's are its approved file's.
 */
export const applyFormalLabels = Effect.fn("passes.applyFormalLabels")(function* (
  db: DatabaseShape,
  lines: ReadonlyArray<FormalLabelLine>
) {
  const valid = yield* stillJudged(db, "ja", lines)
  const ids = [...valid]
  const bySense = yield* sensesByGloss(db, ids)
  const rows: Array<typeof labels.$inferInsert> = []
  const kotoriFormal = and(eq(labels.code, "form"), eq(labels.source, "kotori"))
  let removed = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const held = yield* tx
          .selectDistinct({ entryId: labels.entryId })
          .from(labels)
          .innerJoin(entries, eq(entries.id, labels.entryId))
          .where(and(kotoriFormal, eq(entries.language, "ja"), ne(entries.source, "kotori")))
        const stale = held.map((row) => row.entryId).filter((id) => !valid.has(id))
        removed = stale.length
        const existing = new Map<string, Array<LabelCode>>()
        for (const chunk of chunks(stale, 5000)) {
          yield* tx.delete(labels).where(and(inArray(labels.entryId, [...chunk]), kotoriFormal))
        }
        for (const chunk of chunks(ids, 5000)) {
          yield* tx.delete(labels).where(and(inArray(labels.entryId, [...chunk]), kotoriFormal))
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
            if (!registerUnsaid(existing.get(`${entryId}:${sense}`))) continue
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
  return { written: rows.length, removed } satisfies Applied
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
 * Kotori's cautions from `data/cautions/{ja,en}.jsonl`, replacing Kotori's earlier ones on the
 * language's dictionary words and removing them from words the file doesn't name. Nothing else
 * writes a Kotori caution on a dictionary word: approved words' are their approved files', and are
 * skipped. Only the ranks other sources leave free are taken, so the cap holds. A caution about a
 * sense no longer there is left out.
 */
export const applyCautions = Effect.fn("passes.applyCautions")(function* (
  db: DatabaseShape,
  language: Language,
  lines: ReadonlyArray<CautionLine>
) {
  const valid = yield* stillJudged(db, language, lines)
  const ids = [...valid]
  const bySense = yield* sensesByGloss(db, ids)
  const named = yield* wordsNamed(
    db,
    lines.flatMap((line) => line.cautions.flatMap((caution) => (caution.about === null ? [] : [caution.about]))),
    language
  )
  let written = 0
  let removed = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const held = yield* tx
          .selectDistinct({ entryId: cautions.entryId })
          .from(cautions)
          .innerJoin(entries, eq(entries.id, cautions.entryId))
          .where(and(eq(cautions.source, "kotori"), eq(entries.language, language), ne(entries.source, "kotori")))
        const stale = held.map((row) => row.entryId).filter((id) => !valid.has(id))
        removed = stale.length
        for (const chunk of chunks(stale, 5000)) {
          yield* tx.delete(cautions).where(and(inArray(cautions.entryId, [...chunk]), eq(cautions.source, "kotori")))
        }
        const taken = new Map<EntryId, Set<number>>()
        for (const chunk of chunks(ids, 5000)) {
          yield* tx.delete(cautions).where(and(inArray(cautions.entryId, [...chunk]), eq(cautions.source, "kotori")))
          for (const row of yield* tx
            .select({ entryId: cautions.entryId, rank: cautions.rank })
            .from(cautions)
            .where(inArray(cautions.entryId, [...chunk]))) {
            taken.set(row.entryId, (taken.get(row.entryId) ?? new Set()).add(row.rank))
          }
        }
        const rows: Array<typeof cautions.$inferInsert> = []
        for (const line of lines) {
          const entryId = line.entryId as EntryId
          if (!valid.has(entryId)) continue
          const free = Array.from({ length: MAX_CAUTIONS }, (_, index) => index + 1).filter(
            (rank) => !taken.get(entryId)?.has(rank)
          )
          const placed = line.cautions.flatMap((caution) => {
            const sense = caution.sense === null ? null : bySense.get(entryId)?.get(caution.sense)
            if (sense === undefined) return []
            const about = caution.about === null ? null : named(caution.about)
            return [
              {
                entryId,
                sense,
                kind: caution.kind,
                text: caution.text,
                aboutEntryId: about,
                source: "kotori" as const
              }
            ]
          })
          rows.push(...placed.slice(0, free.length).map((row, index) => ({ ...row, rank: free[index]! })))
        }
        for (const chunk of chunks(rows, 2000)) yield* tx.insert(cautions).values([...chunk])
        written = rows.length
      })
    )
    .pipe(Effect.orDie)
  return { written, removed } satisfies Applied
})

/**
 * Kotori's loan verdicts from `data/loans/verdicts.jsonl`: each sets `meaning` on its pair, judged
 * by Kotori (`meaning_source`), adding the pair as Kotori's where JMdict doesn't name it. A
 * meaning another source judged is kept; Kotori's own is replaced, so the file decides. A verdict
 * the file no longer gives is removed: a pair only Kotori named goes, and one JMdict names loses
 * its verdict. The loan import is the only writer of a verdict. A verdict-less line adds nothing,
 * and a line counts only while both its words are still the words judged, neither approved.
 */
export const applyLoanVerdicts = Effect.fn("passes.applyLoanVerdicts")(function* (
  db: DatabaseShape,
  lines: ReadonlyArray<LoanLine>
) {
  const verdicts = lines.filter(
    (line): line is LoanLine & { katakana: string; meaning: LoanLinkMeaning } =>
      line.katakana !== null && line.meaning !== null
  )
  const english = yield* stillJudged(
    db,
    "en",
    verdicts.map((line) => ({ entryId: line.englishId, headword: line.english }))
  )
  const katakana = yield* stillJudged(
    db,
    "ja",
    verdicts.flatMap((line) =>
      line.katakanaId === null ? [] : [{ entryId: line.katakanaId, headword: line.katakana }]
    )
  )
  const valid = verdicts.filter(
    (line) =>
      english.has(line.englishId as EntryId) && (line.katakanaId === null || katakana.has(line.katakanaId as EntryId))
  )
  const pair = (katakana: string, english: string) => `${katakana}\u0000${english}`
  const covered = new Set(valid.map((line) => pair(line.katakana, line.english)))
  let written = 0
  let removed = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const held = yield* tx
          .select({
            id: loanLinks.id,
            katakana: loanLinks.katakana,
            english: loanLinks.english,
            source: loanLinks.source
          })
          .from(loanLinks)
          .where(eq(loanLinks.meaningSource, "kotori"))
        const stale = held.filter((row) => !covered.has(pair(row.katakana, row.english)))
        removed = stale.length
        const onlyKotori = stale.flatMap((row) => (row.source === "kotori" ? [row.id] : []))
        const named = stale.flatMap((row) => (row.source === "kotori" ? [] : [row.id]))
        for (const chunk of chunks(onlyKotori, 5000)) {
          yield* tx.delete(loanLinks).where(inArray(loanLinks.id, [...chunk]))
        }
        for (const chunk of chunks(named, 5000)) {
          yield* tx
            .update(loanLinks)
            .set({ meaning: null, meaningSource: null })
            .where(inArray(loanLinks.id, [...chunk]))
        }
        for (const chunk of chunks(valid, 1000)) {
          const values = sql.join(
            chunk.map(
              (line) =>
                sql`(${line.katakana}, ${line.katakanaId}::integer, ${line.english}, ${line.englishId}::integer, ${line.meaning}::loan_meaning)`
            ),
            sql`, `
          )
          const result = yield* tx.execute(sql`
            INSERT INTO ${loanLinks} (katakana, katakana_entry_id, english, english_entry_id, meaning, meaning_source, source)
            SELECT katakana, katakana_entry_id, english, english_entry_id, meaning, 'kotori', 'kotori'
            FROM (VALUES ${values}) AS v(katakana, katakana_entry_id, english, english_entry_id, meaning)
            ON CONFLICT (katakana, english) DO UPDATE
            SET meaning = excluded.meaning,
                meaning_source = 'kotori',
                katakana_entry_id = coalesce(${loanLinks}.katakana_entry_id, excluded.katakana_entry_id),
                english_entry_id = coalesce(${loanLinks}.english_entry_id, excluded.english_entry_id)
            WHERE (${loanLinks}.meaning IS NULL OR ${loanLinks}.meaning_source = 'kotori')
              AND (${loanLinks}.meaning, ${loanLinks}.meaning_source) IS DISTINCT FROM (excluded.meaning, 'kotori')
            RETURNING 1
          `)
          written += (result as { readonly rows: ReadonlyArray<unknown> }).rows.length
        }
      })
    )
    .pipe(Effect.orDie)
  return { written, removed } satisfies Applied
})

/**
 * Applies every pass's artifact, in an order that needs both dictionaries for loans, and says
 * what each filled and removed. A pass whose file is absent removes all it gave. Called by
 * `kotori seed` after its imports; `files` points elsewhere in tests.
 */
export const applyArtifacts = Effect.fn("passes.applyArtifacts")(function* (
  db: DatabaseShape,
  files: { readonly [P in Pass]: string } = ARTIFACTS
) {
  const report = (path: string, present: boolean, applied: Applied, what: string, gone: string, unit = "words") => {
    const removed = applied.removed > 0 ? `removed ${gone} from ${applied.removed.toLocaleString()} ${unit}` : null
    if (!present) return removed === null ? Effect.void : Console.log(`No ${path}: ${removed}.`)
    return Console.log(
      `Applied ${path}: ${applied.written.toLocaleString()} ${what}` +
        (removed === null ? "." : `; ${removed} it no longer names.`)
    )
  }
  const formal = yield* readArtifact(files["ja-form"], FormalLabelLine, "ja-form")
  const formalApplied = yield* applyFormalLabels(db, formal?.lines ?? [])
  yield* report(files["ja-form"], formal !== null, formalApplied, "formal labels", "Kotori's formal labels")
  for (const language of ["ja", "en"] as const) {
    const pass = `cautions-${language}` as const
    const file = yield* readArtifact(files[pass], CautionLine, pass)
    const applied = yield* applyCautions(db, language, file?.lines ?? [])
    yield* report(files[pass], file !== null, applied, "cautions", "Kotori's cautions")
  }
  const loans = yield* readArtifact(files.loans, LoanLine, "loans")
  const loansApplied = yield* applyLoanVerdicts(db, loans?.lines ?? [])
  yield* report(files.loans, loans !== null, loansApplied, "loan verdicts changed", "Kotori's verdicts", "pairs")
})
