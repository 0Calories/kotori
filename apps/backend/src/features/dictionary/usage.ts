import type { EntryCaution, EntryFrequency, Label, LoanLink, UsagePattern, WordRef } from "@kotori/contracts"
import { entries, type EntryId, entrySearch, isGlossSearch, labelSeverity, MAX_CAUTIONS } from "@kotori/db"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { type EntryDocument, getEntryDocuments } from "./queries.ts"

/**
 * Reads of usage facts and enrichment for the entry page: labels, usage patterns, cautions,
 * frequency signals, loan links (all directly from `entries.base` + `entries.enrichment`),
 * and similar-word candidates (from `entry_search`).
 */

const wordRefs = Effect.fnUntraced(function* (db: DatabaseShape, ids: ReadonlyArray<EntryId | null>) {
  const wanted = [...new Set(ids.filter((id): id is EntryId => id !== null))]
  if (wanted.length === 0) return new Map<EntryId, WordRef>()
  const rows = yield* db
    .select({
      entryId: entries.id,
      headword: sql<string>`${entries.base}->>'headword'`,
      reading: sql<string>`${entries.base}->>'reading'`
    })
    .from(entries)
    .where(inArray(entries.id, wanted))
  return new Map(rows.map((row) => [row.entryId, row]))
})

/** Extracts one entry's merged labels by sense (base labels first, then any enrichment labels not already present). */
export const extractLabelsBySense = (doc: EntryDocument): Map<number, Array<Label>> => {
  const bySense = new Map<number, Map<string, Label>>()
  doc.base.senses.forEach((sense, index) => {
    const map = new Map<string, Label>()
    for (const label of sense.labels ?? []) {
      map.set(label.code, { code: label.code, severity: labelSeverity(label.code), source: label.source })
    }
    if (map.size > 0) bySense.set(index, map)
  })
  for (const label of doc.enrichment?.labels ?? []) {
    const map = bySense.get(label.sense) ?? new Map<string, Label>()
    bySense.set(label.sense, map)
    if (!map.has(label.code)) {
      map.set(label.code, { code: label.code, severity: labelSeverity(label.code), source: label.source })
    }
  }
  const result = new Map<number, Array<Label>>()
  for (const [senseIndex, map] of bySense) {
    result.set(
      senseIndex,
      [...map.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    )
  }
  return result
}

/** Each sense's labels, by sense position, in code order. */
export const labelsBySense = Effect.fn("dictionary.labelsBySense")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  const found = new Map<EntryId, Map<number, Array<Label>>>()
  if (entryIds.length === 0) return found
  const docs = yield* getEntryDocuments(db, entryIds)
  for (const doc of docs) found.set(doc.id, extractLabelsBySense(doc))
  return found
}, Effect.orDie)

/** An entry's usage patterns (base + enrichment), by sense position, in order. */
export const usagePatternsBySense = Effect.fn("dictionary.usagePatternsBySense")(function* (
  db: DatabaseShape,
  doc: EntryDocument
) {
  const raw: Array<{
    readonly sense: number
    readonly text: string
    readonly source: UsagePattern["source"]
    readonly aboutEntryId: EntryId | null
  }> = []
  doc.base.senses.forEach((sense, index) => {
    for (const pattern of sense.usagePatterns ?? []) {
      raw.push({ sense: index, text: pattern.text, source: pattern.source, aboutEntryId: pattern.aboutEntryId ?? null })
    }
  })
  for (const pattern of doc.enrichment?.usagePatterns ?? []) {
    raw.push({ sense: pattern.sense, text: pattern.text, source: pattern.source, aboutEntryId: pattern.aboutEntryId })
  }
  const about = yield* wordRefs(
    db,
    raw.map((row) => row.aboutEntryId)
  )
  const found = new Map<number, Array<UsagePattern>>()
  for (const row of raw) {
    const usagePattern: UsagePattern = {
      text: row.text,
      source: row.source,
      about: row.aboutEntryId === null ? null : (about.get(row.aboutEntryId) ?? null)
    }
    found.set(row.sense, [...(found.get(row.sense) ?? []), usagePattern])
  }
  return found
}, Effect.orDie)

/** An entry's cautions (base + enrichment, capped at `MAX_CAUTIONS`), first first. */
export const cautionsFor = Effect.fn("dictionary.cautionsFor")(function* (db: DatabaseShape, doc: EntryDocument) {
  const combined = [...(doc.base.cautions ?? []), ...(doc.enrichment?.cautions ?? [])].slice(0, MAX_CAUTIONS)
  const about = yield* wordRefs(
    db,
    combined.map((row) => row.aboutEntryId)
  )
  return combined.map((row, index): EntryCaution => ({
    id: index + 1,
    kind: row.kind,
    text: row.text,
    sense: row.sense,
    about: row.aboutEntryId === null ? null : (about.get(row.aboutEntryId) ?? null),
    source: row.source
  }))
}, Effect.orDie)

export const frequencyOf = (doc: EntryDocument): EntryFrequency | null => doc.base.frequency ?? null

export const loanLinkOf = (doc: EntryDocument): LoanLink | null => doc.enrichment?.loanLink ?? doc.base.loanLink ?? null

/**
 * Words in the same dictionary close to each of an entry's senses by their glosses, most used
 * first, at most `perSense` a sense, with the earliest sense of theirs that is close.
 */
export const sharedGlossesBySense = Effect.fn("dictionary.sharedGlossesBySense")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  perSense: number
) {
  const own = alias(entrySearch, "own")
  const theirs = alias(entrySearch, "theirs")
  const pairs = db.$with("pairs").as(
    db
      .select({
        sense: sql<number>`${own.sense}`.as("sense"),
        entryId: sql<EntryId>`${theirs.entryId}`.as("entry_id"),
        otherSense: sql<number>`${theirs.sense}`.as("other_sense"),
        priority: sql<number>`max(${theirs.priority})`.as("priority"),
        shared: sql<number>`count(DISTINCT ${own.norm})`.as("shared"),
        bothLead: sql<boolean>`bool_or(${own.position} = 0 AND ${theirs.position} = 0)`.as("both_lead")
      })
      .from(own)
      .innerJoin(
        theirs,
        and(
          isGlossSearch(theirs.kind),
          eq(theirs.language, own.language),
          eq(theirs.norm, own.norm),
          eq(theirs.common, true),
          sql`${theirs.entryId} <> ${own.entryId}`
        )
      )
      .where(and(isGlossSearch(own.kind), eq(own.entryId, entryId), sql`length(${own.norm}) > 1`))
      .groupBy(own.sense, theirs.entryId, theirs.sense)
  )
  const close = db.$with("close").as(
    db
      .select({
        sense: pairs.sense,
        entryId: pairs.entryId,
        otherSense: sql<number>`min(${pairs.otherSense})`.as("close_sense"),
        rank: sql<number>`row_number() OVER (PARTITION BY ${pairs.sense} ORDER BY max(${pairs.priority}) DESC, ${pairs.entryId})`.as(
          "rank"
        )
      })
      .from(pairs)
      .where(sql`${pairs.shared} >= 2 OR ${pairs.bothLead}`)
      .groupBy(pairs.sense, pairs.entryId)
  )
  return yield* db
    .with(pairs, close)
    .select({ sense: close.sense, entryId: close.entryId, otherSense: close.otherSense })
    .from(close)
    .where(sql`${close.rank} <= ${perSense}`)
    .orderBy(asc(close.sense), asc(close.rank))
}, Effect.orDie)
