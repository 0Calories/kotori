import type { Label, LoanLink, Pattern, UsageEvidence, WordPitfall, WordRef } from "@kotori/contracts"
import {
  entries,
  type EntryId,
  glosses,
  labels,
  labelSeverity,
  loanLinks,
  patterns,
  pitfalls,
  usageEvidence
} from "@kotori/db"
import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

/**
 * Reads of the enrichment model for the entry page: labels, patterns and pitfalls with the words
 * they point at, evidence of use, the loan link, and the candidates for similar words.
 */

const wordRefs = Effect.fnUntraced(function* (db: DatabaseShape, ids: ReadonlyArray<EntryId | null>) {
  const wanted = [...new Set(ids.filter((id): id is EntryId => id !== null))]
  if (wanted.length === 0) return new Map<EntryId, WordRef>()
  const rows = yield* db
    .select({ entryId: entries.id, headword: entries.headword, reading: entries.reading })
    .from(entries)
    .where(inArray(entries.id, wanted))
  return new Map(rows.map((row) => [row.entryId, row]))
})

/** Each sense's labels, by sense position, in code order so a page lists them alike every time. */
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

/** An entry's patterns, by sense position, in order. */
export const patternsBySense = Effect.fn("dictionary.patternsBySense")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db
    .select()
    .from(patterns)
    .where(eq(patterns.entryId, entryId))
    .orderBy(asc(patterns.sense), asc(patterns.position))
  const about = yield* wordRefs(
    db,
    rows.map((row) => row.aboutEntryId)
  )
  const found = new Map<number, Array<Pattern>>()
  for (const row of rows) {
    const pattern: Pattern = {
      text: row.text,
      source: row.source,
      about: row.aboutEntryId === null ? null : (about.get(row.aboutEntryId) ?? null)
    }
    found.set(row.sense, [...(found.get(row.sense) ?? []), pattern])
  }
  return found
}, Effect.orDie)

/** An entry's pitfalls, first first. */
export const pitfallsFor = Effect.fn("dictionary.pitfallsFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db.select().from(pitfalls).where(eq(pitfalls.entryId, entryId)).orderBy(asc(pitfalls.rank))
  const about = yield* wordRefs(
    db,
    rows.map((row) => row.aboutEntryId)
  )
  return rows.map((row): WordPitfall => ({
    id: row.id,
    kind: row.kind,
    text: row.text,
    sense: row.sense,
    about: row.aboutEntryId === null ? null : (about.get(row.aboutEntryId) ?? null),
    source: row.source
  }))
}, Effect.orDie)

export const evidenceFor = Effect.fn("dictionary.evidenceFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const [row] = yield* db
    .select({
      everyday: usageEvidence.everyday,
      spokenCount: usageEvidence.spokenCount,
      familiarity: usageEvidence.familiarity
    })
    .from(usageEvidence)
    .where(eq(usageEvidence.entryId, entryId))
  return (row ?? null) satisfies UsageEvidence | null
}, Effect.orDie)

/**
 * The loan link read from this entry's end: as the katakana word or as the English one. A word
 * with several (an English word borrowed twice) shows the one with a verdict on its meaning, then
 * the one whose other word is used most.
 */
export const loanLinkFor = Effect.fn("dictionary.loanLinkFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const other = alias(entries, "other")
  const [row] = yield* db
    .select({
      katakana: loanLinks.katakana,
      katakanaEntryId: loanLinks.katakanaEntryId,
      english: loanLinks.english,
      englishEntryId: loanLinks.englishEntryId,
      meaning: loanLinks.meaning,
      source: loanLinks.source
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

/**
 * Words in the same dictionary close to each of an entry's senses by their glosses, most used
 * first, at most `perSense` a sense, with the earliest sense of theirs that is close. A sense of
 * theirs is close when it shares two glosses with ours, or when both senses lead with the same
 * one: glosses are polysemous English or Japanese words, and one shared in passing ties 結構
 * ("fine", splendid) to 罰金 ("fine", a penalty). Common words only: a gloss shared with a rare
 * word says little to a learner. One query for every sense, as the page asks on each view.
 */
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
      .where(sql`${pairs.shared} >= 2 OR ${pairs.bothLead}`)
      .groupBy(pairs.sense, pairs.entryId)
  )
  // Integer columns, and `min` of one, which both drivers return as numbers.
  return yield* db
    .with(pairs, close)
    .select({ sense: close.sense, entryId: close.entryId, otherSense: close.otherSense })
    .from(close)
    .where(sql`${close.rank} <= ${perSense}`)
    .orderBy(asc(close.sense), asc(close.rank))
}, Effect.orDie)
