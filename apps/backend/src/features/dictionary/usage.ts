import type { EntryCaution, EntryFrequency, Label, LoanLink, UsagePattern, WordRef } from "@kotori/contracts"
import {
  cautions,
  entries,
  type EntryId,
  entryFrequency,
  glosses,
  labels,
  labelSeverity,
  loanLinks,
  usagePatterns
} from "@kotori/db"
import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

const wordRefs = Effect.fnUntraced(function* (db: DatabaseShape, ids: ReadonlyArray<EntryId | null>) {
  const wanted = [...new Set(ids.filter((id): id is EntryId => id !== null))]
  if (wanted.length === 0) return new Map<EntryId, WordRef>()
  const rows = yield* db
    .select({ entryId: entries.id, headword: entries.headword, reading: entries.reading })
    .from(entries)
    .where(inArray(entries.id, wanted))
  return new Map(rows.map((row) => [row.entryId, row]))
})

export const labelsBySense = Effect.fn("dictionary.labelsBySense")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  const found = new Map<EntryId, Map<number, Array<Label>>>()
  if (entryIds.length === 0) return found
  const rows = yield* db
    .select()
    .from(labels)
    .where(inArray(labels.entryId, [...entryIds]))
    .orderBy(asc(labels.entryId), asc(labels.sense), asc(labels.code))
  for (const row of rows) {
    const bySense = found.get(row.entryId) ?? new Map<number, Array<Label>>()
    found.set(row.entryId, bySense)
    bySense.set(row.sense, [
      ...(bySense.get(row.sense) ?? []),
      { code: row.code, severity: labelSeverity(row.code), source: row.source }
    ])
  }
  return found
}, Effect.orDie)

export const usagePatternsBySense = Effect.fn("dictionary.usagePatternsBySense")(function* (
  db: DatabaseShape,
  entryId: EntryId
) {
  const rows = yield* db
    .select()
    .from(usagePatterns)
    .where(eq(usagePatterns.entryId, entryId))
    .orderBy(asc(usagePatterns.sense), asc(usagePatterns.position))
  const about = yield* wordRefs(
    db,
    rows.map((row) => row.aboutEntryId)
  )
  const found = new Map<number, Array<UsagePattern>>()
  for (const row of rows) {
    const usagePattern: UsagePattern = {
      text: row.text,
      source: row.source,
      about: row.aboutEntryId === null ? null : (about.get(row.aboutEntryId) ?? null)
    }
    found.set(row.sense, [...(found.get(row.sense) ?? []), usagePattern])
  }
  return found
}, Effect.orDie)

export const cautionsFor = Effect.fn("dictionary.cautionsFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db.select().from(cautions).where(eq(cautions.entryId, entryId)).orderBy(asc(cautions.rank))
  const about = yield* wordRefs(
    db,
    rows.map((row) => row.aboutEntryId)
  )
  return rows.map((row): EntryCaution => ({
    id: row.id,
    kind: row.kind,
    text: row.text,
    sense: row.sense,
    about: row.aboutEntryId === null ? null : (about.get(row.aboutEntryId) ?? null),
    source: row.source
  }))
}, Effect.orDie)

export const frequencyFor = Effect.fn("dictionary.frequencyFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const [row] = yield* db
    .select({
      everyday: entryFrequency.everyday,
      spokenCount: entryFrequency.spokenCount,
      score: entryFrequency.score
    })
    .from(entryFrequency)
    .where(eq(entryFrequency.entryId, entryId))
  return (row ?? null) satisfies EntryFrequency | null
}, Effect.orDie)

export const loanLinkFor = Effect.fn("dictionary.loanLinkFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const other = alias(entries, "other")
  const [row] = yield* db
    .select({
      katakana: loanLinks.katakana,
      katakanaEntryId: loanLinks.katakanaEntryId,
      english: loanLinks.english,
      englishEntryId: loanLinks.englishEntryId,
      meaning: loanLinks.meaning,
      source: loanLinks.source,
      meaningSource: loanLinks.meaningSource
    })
    .from(loanLinks)
    .leftJoin(
      other,
      sql`${other.id} = CASE WHEN ${loanLinks.katakanaEntryId} = ${entryId} THEN ${loanLinks.englishEntryId} ELSE ${loanLinks.katakanaEntryId} END`
    )
    .where(or(eq(loanLinks.katakanaEntryId, entryId), eq(loanLinks.englishEntryId, entryId)))
    .orderBy(sql`${loanLinks.meaning} IS NULL`, sql`${other.priority} DESC NULLS LAST`, asc(loanLinks.id))
    .limit(1)
  return (row ?? null) satisfies LoanLink | null
}, Effect.orDie)

export const sharedGlossesBySense = Effect.fn("dictionary.sharedGlossesBySense")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  perSense: number
) {
  const own = alias(glosses, "own")
  const theirs = alias(glosses, "theirs")
  const self = alias(entries, "self")
  const pairs = db.$with("pairs").as(
    db
      .select({
        sense: sql<number>`${own.sense}`.as("sense"),
        entryId: sql<EntryId>`${theirs.entryId}`.as("entry_id"),
        otherSense: sql<number>`${theirs.sense}`.as("other_sense"),
        shared: sql<number>`count(DISTINCT ${own.norm})`.as("shared"),
        bothLead: sql<boolean>`bool_or(${own.position} = 0 AND ${theirs.position} = 0)`.as("both_lead")
      })
      .from(own)
      .innerJoin(self, eq(self.id, own.entryId))
      .innerJoin(theirs, and(eq(theirs.norm, own.norm), sql`${theirs.entryId} <> ${own.entryId}`))
      .innerJoin(
        entries,
        and(eq(entries.id, theirs.entryId), eq(entries.language, self.language), eq(entries.common, true))
      )
      .where(and(eq(own.entryId, entryId), sql`length(${own.norm}) > 1`))
      .groupBy(own.sense, theirs.entryId, theirs.sense)
  )
  const close = db.$with("close").as(
    db
      .select({
        sense: pairs.sense,
        entryId: pairs.entryId,
        otherSense: sql<number>`min(${pairs.otherSense})`.as("close_sense"),
        rank: sql<number>`row_number() OVER (PARTITION BY ${pairs.sense} ORDER BY max(${entries.priority}) DESC, ${pairs.entryId})`.as(
          "rank"
        )
      })
      .from(pairs)
      .innerJoin(entries, eq(entries.id, pairs.entryId))
      // Require two shared glosses or matching lead glosses so a single polysemous gloss ("fine") does not link unrelated senses (結構 and 罰金).
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

export const takeawaysBySense = Effect.fn("dictionary.takeawaysBySense")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  const found = new Map<EntryId, (sense: number) => string | null>()
  if (entryIds.length === 0) return found
  const [cautionRows, patternRows] = yield* Effect.all([
    db
      .select({ entryId: cautions.entryId, sense: cautions.sense, text: cautions.text })
      .from(cautions)
      .where(inArray(cautions.entryId, [...entryIds]))
      .orderBy(asc(cautions.entryId), asc(cautions.rank)),
    db
      .select({ entryId: usagePatterns.entryId, sense: usagePatterns.sense, text: usagePatterns.text })
      .from(usagePatterns)
      .where(inArray(usagePatterns.entryId, [...entryIds]))
      .orderBy(asc(usagePatterns.entryId), asc(usagePatterns.sense), asc(usagePatterns.position))
  ])
  for (const entryId of entryIds) {
    const own = cautionRows.filter((row) => row.entryId === entryId)
    const patterns = patternRows.filter((row) => row.entryId === entryId)
    const word = own.find((row) => row.sense === null)?.text ?? null
    found.set(
      entryId,
      (sense) =>
        own.find((row) => row.sense === sense)?.text ??
        word ??
        patterns.find((row) => row.sense === sense)?.text ??
        null
    )
  }
  return found
}, Effect.orDie)
