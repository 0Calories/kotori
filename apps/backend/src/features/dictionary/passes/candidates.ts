import type { LoanCandidate, WordToJudge } from "@kotori/ai"
import { loanSenseLine } from "@kotori/ai"
import type { EntryRecord, LabelCode, Language } from "@kotori/contracts"
import { entries, type EntryId, entrySearch, isGlossSearch, labelSeverity } from "@kotori/db"
import { normalizeGloss } from "@kotori/language"
import { and, asc, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import { chunks } from "../../../db/chunks.ts"
import type { DatabaseShape } from "../../../db/Database.ts"
import { documentToRecord, type EntryDocument, getEntryDocuments, tagNames } from "../queries.ts"
import { extractLabelsBySense, loanLinkOf } from "../usage.ts"

/** Senses shown to Claude per word: later ones rarely matter, and long entries would crowd a batch. */
export const CAUTION_SENSES = 10

/** Senses of a word Jev is asked about for `form`. */
export const FORMAL_LABEL_SENSES = 6

/** A word written in katakana alone, as loanwords are (スタイル, コーヒー); valid in JavaScript and Postgres. */
export const KATAKANA_WORD = "^[゠-ヿ]+$"

export interface PassQuery {
  readonly language: Language
  /** Only words the dictionary marks common; off, every word. */
  readonly commonOnly: boolean
  /** Entries already judged, skipped. */
  readonly judged: ReadonlySet<string>
  readonly limit: number
}

const pickEntries = Effect.fnUntraced(function* <T>(
  db: DatabaseShape,
  query: PassQuery,
  keep: (docs: ReadonlyArray<EntryDocument>) => Effect.Effect<ReadonlyArray<T>>
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
          ne(entries.source, "kotori"),
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
    const kept = yield* keep(yield* getEntryDocuments(db, ids))
    picked.push(...kept.slice(0, query.limit - picked.length))
  }
  return picked
})

/** The word as a model is shown it: its senses with their labels and usage patterns. */
export const wordToJudge = (
  entry: EntryRecord,
  labelsBySense: ReadonlyMap<number, ReadonlyArray<LabelCode>> | undefined,
  usagePatternsBySense: ReadonlyMap<number, ReadonlyArray<string>> | undefined,
  senseLimit: number
): WordToJudge => ({
  headword: entry.headword,
  reading: entry.reading,
  senses: entry.senses.slice(0, senseLimit).map((sense, position) => ({
    glosses: sense.glosses.map((gloss) => gloss.text),
    pos: sense.pos,
    labels: labelsBySense?.get(position) ?? [],
    usagePatterns: usagePatternsBySense?.get(position) ?? []
  }))
})

export const registerUnsaid = (codes: ReadonlyArray<LabelCode> | undefined) =>
  (codes ?? []).every((code) => code !== "form" && labelSeverity(code) === "quiet")

export interface FormalLabelCandidate {
  readonly entryId: EntryId
  readonly word: WordToJudge
  readonly senses: ReadonlyArray<number>
}

const labelCodesOf = (doc: EntryDocument) => {
  const bySense = extractLabelsBySense(doc)
  const codes = new Map<number, ReadonlyArray<LabelCode>>()
  for (const [sense, list] of bySense)
    codes.set(
      sense,
      list.map((l) => l.code)
    )
  return codes
}

const usageTextsOf = (doc: EntryDocument) => {
  const found = new Map<number, Array<string>>()
  doc.base.senses.forEach((sense, index) => {
    for (const p of sense.usagePatterns ?? []) found.set(index, [...(found.get(index) ?? []), p.text])
  })
  for (const p of doc.enrichment?.usagePatterns ?? []) {
    found.set(p.sense, [...(found.get(p.sense) ?? []), p.text])
  }
  return found
}

/** Japanese words with a sense whose register the dictionary leaves unsaid; see `registerUnsaid`. */
export const formalLabelCandidates = Effect.fn("passes.formalLabelCandidates")(function* (
  db: DatabaseShape,
  query: Omit<PassQuery, "language">
) {
  return yield* pickEntries(db, { ...query, language: "ja" }, (docs) =>
    Effect.succeed(
      docs.flatMap((doc): Array<FormalLabelCandidate> => {
        const record = documentToRecord(doc)
        const own = labelCodesOf(doc)
        const asked = record.senses
          .slice(0, FORMAL_LABEL_SENSES)
          .flatMap((sense, position) =>
            sense.glosses.length > 0 && registerUnsaid(own.get(position)) ? [position] : []
          )
        return asked.length === 0
          ? []
          : [{ entryId: doc.id, word: wordToJudge(record, own, undefined, FORMAL_LABEL_SENSES), senses: asked }]
      })
    )
  )
})

export interface CautionCandidate {
  readonly entryId: EntryId
  readonly word: WordToJudge
}

/** Words of one language to write cautions for, as their pages show them. */
export const cautionCandidates = Effect.fn("passes.cautionCandidates")(function* (db: DatabaseShape, query: PassQuery) {
  return yield* pickEntries(db, query, (docs) =>
    Effect.gen(function* () {
      const otherIds = [
        ...new Set(
          docs.flatMap((doc) => {
            const link = loanLinkOf(doc)
            if (link === null) return []
            const otherId = query.language === "en" ? link.katakanaEntryId : link.englishEntryId
            return otherId === null ? [] : [otherId]
          })
        )
      ]
      const others = new Map((yield* getEntryDocuments(db, otherIds)).map((d) => [d.id, d]))
      return docs.map((doc): CautionCandidate => {
        const record = documentToRecord(doc)
        const link = loanLinkOf(doc)
        let loan: WordToJudge["loan"] = null
        if (link !== null) {
          const otherId = query.language === "en" ? link.katakanaEntryId : link.englishEntryId
          const otherDoc = otherId === null ? undefined : others.get(otherId)
          loan = {
            word: query.language === "en" ? link.katakana : link.english,
            meaning: link.meaning,
            glosses: otherDoc?.base.senses.slice(0, 3).flatMap((s) => s.glosses.map((g) => g.text)) ?? []
          }
        }
        return {
          entryId: doc.id,
          word: {
            ...wordToJudge(record, labelCodesOf(doc), usageTextsOf(doc), CAUTION_SENSES),
            loan
          }
        }
      })
    })
  )
})

interface FoundLoan {
  readonly word: string
  readonly entryId: EntryId
  readonly by: LoanCandidate["by"]
  readonly priority: number
}

/** Common katakana words that may be the loanword of each English word. */
export const loanCandidates = Effect.fn("passes.loanCandidates")(function* (
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
    sql`${entries.base}->>'headword' ~ ${KATAKANA_WORD}`
  )
  const add = (row: FoundLoan) => {
    const forWord = found.get(row.word) ?? new Map<EntryId, FoundLoan>()
    if (row.by === "source" || !forWord.has(row.entryId)) forWord.set(row.entryId, row)
    found.set(row.word, forWord)
  }
  for (const chunk of chunks(wanted, 2000)) {
    const byGloss = yield* db
      .selectDistinct({ word: entrySearch.norm, entryId: entrySearch.entryId, priority: entries.priority })
      .from(entrySearch)
      .innerJoin(entries, eq(entries.id, entrySearch.entryId))
      .where(and(isGlossSearch(entrySearch.kind), inArray(entrySearch.norm, [...chunk]), katakana))
      .pipe(Effect.orDie)
    for (const row of byGloss) {
      if (row.word !== null) add({ word: row.word, entryId: row.entryId, by: "gloss", priority: row.priority })
    }
    const set = new Set(chunk)
    const katakanaRows = yield* db
      .select({ id: entries.id, priority: entries.priority, base: entries.base })
      .from(entries)
      .where(katakana)
      .pipe(Effect.orDie)
    for (const row of katakanaRows) {
      for (const sense of row.base.senses) {
        for (const origin of sense.origins) {
          if (origin.language !== "eng" || origin.word === null) continue
          const word = normalizeGloss(origin.word)
          if (set.has(word)) add({ word, entryId: row.id, by: "source", priority: row.priority })
        }
      }
    }
  }
  for (const [word, forWord] of found) {
    const ranked = [...forWord.values()]
      .sort(
        (a, b) =>
          Number(b.by === "source") - Number(a.by === "source") ||
          b.priority - a.priority ||
          (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0)
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

/** English words whose loan has no verdict yet, with their katakana candidates. */
export const loanCandidateWords = Effect.fn("passes.loanCandidateWords")(function* (
  db: DatabaseShape,
  query: Omit<PassQuery, "language">,
  limit: number
) {
  const tags = yield* tagNames(db)
  return yield* pickEntries(db, { ...query, language: "en" }, (docs) =>
    Effect.gen(function* () {
      const open = docs.filter((doc) => loanLinkOf(doc)?.meaning == null)
      const found = yield* loanCandidates(
        db,
        open.map((doc) => doc.base.headword),
        limit
      )
      const katakanaIds = [...new Set([...found.values()].flatMap((forWord) => [...forWord.keys()]))]
      const katakana = new Map((yield* getEntryDocuments(db, katakanaIds)).map((d) => [d.id, documentToRecord(d)]))
      return open.flatMap((doc): Array<LoanCandidateWord> => {
        const forWord = found.get(normalizeGloss(doc.base.headword))
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
        return candidates.length === 0 ? [] : [{ entryId: doc.id, english: doc.base.headword, candidates }]
      })
    })
  )
})
