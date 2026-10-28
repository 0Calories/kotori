import { at, Database } from "@kotori/db"
import { entries, glosses, senseNuance, similarWords } from "@kotori/db/schema"
import type { EntryRecord } from "@kotori/jmdict"
import { type CandidateState, judgeEntry } from "@kotori/nuance"
import { and, desc, eq, inArray, max, ne, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Clock, Effect, Schema } from "effect"
import { findForms, getEntries, tagLabels } from "../dictionary/entries.ts"

/** Similar words are looked for on the main senses only. */
const SIMILAR_SENSES = 3
const MAX_CANDIDATES = 8

export class EntryNotFound extends Schema.TaggedError<EntryNotFound>()("EntryNotFound", { entryId: Schema.Int }) {}

/** Jev's nuance per sense for the given entries. */
export const nuanceFor = Effect.fn("enrichment.nuanceFor")(function* (entryIds: ReadonlyArray<number>) {
  if (entryIds.length === 0) return []
  const db = yield* Database
  return yield* db
    .select({
      entryId: senseNuance.entryId,
      sense: senseNuance.sense,
      nuance: senseNuance.nuance,
      model: senseNuance.model
    })
    .from(senseNuance)
    .where(inArray(senseNuance.entryId, entryIds))
}, Effect.orDie)

/** Other entries sharing an exact gloss with the given sense. */
const sharedGlossCandidates = Effect.fn("enrichment.sharedGlossCandidates")(function* (
  entryId: number,
  sense: number,
  limit: number
) {
  const db = yield* Database
  const g1 = alias(glosses, "g1")
  const g2 = alias(glosses, "g2")
  return yield* db
    .select({
      entryId: g2.entryId,
      sense: sql<number>`min(${g2.sense})`.mapWith(Number),
      gloss: sql<string>`min(${g2.text})`.mapWith(String)
    })
    .from(g1)
    .innerJoin(g2, and(eq(g2.norm, g1.norm), ne(g2.entryId, g1.entryId)))
    .innerJoin(entries, eq(entries.id, g2.entryId))
    .where(and(eq(g1.entryId, entryId), eq(g1.sense, sense), sql`length(${g1.norm}) > 1`))
    .groupBy(g2.entryId)
    .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)))
    .limit(limit)
}, Effect.orDie)

/** Candidates for "similar words": JMDict "see also" references first (curated), then words sharing an exact gloss. */
const candidatesFor = Effect.fnUntraced(function* (entry: EntryRecord, senseIndex: number) {
  const sense = entry.senses[senseIndex]!
  const xrefTexts = sense.xrefs.map((xref) => xref.split("・")[0]!).filter((text) => text.length > 0)
  const xrefMatches = yield* findForms(xrefTexts)
  const shared = yield* sharedGlossCandidates(entry.id, senseIndex, MAX_CANDIDATES)

  const ids = [...new Set([...xrefMatches.map((match) => match.entryId), ...shared.map((c) => c.entryId)])]
    .filter((id) => id !== entry.id)
    .slice(0, MAX_CANDIDATES)

  return (yield* getEntries(ids)).map((candidate): CandidateState => {
    const matchedSense = shared.find((c) => c.entryId === candidate.id)?.sense ?? 0
    const meanings = candidate.senses[matchedSense]?.glosses ?? candidate.senses[0]?.glosses ?? []
    return {
      entryId: candidate.id,
      word: candidate.headword,
      reading: candidate.reading,
      meaning: meanings
        .slice(0, 3)
        .map((gloss) => gloss.text)
        .join("; ")
    }
  })
})

/** Has Jev judge an entry's senses and similar words, replacing whatever was judged before. */
export const judgeNuance = Effect.fn("enrichment.judgeNuance")(function* (entryId: number) {
  const [entry] = yield* getEntries([entryId])
  if (entry === undefined) return yield* new EntryNotFound({ entryId })
  const tags = yield* tagLabels
  const candidates = yield* Effect.forEach(entry.senses.slice(0, SIMILAR_SENSES), (_, index) =>
    candidatesFor(entry, index)
  )
  const judgment = yield* judgeEntry(entry, tags, candidates)

  const db = yield* Database
  const now = at(yield* Clock.currentTimeMillis)
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.delete(senseNuance).where(eq(senseNuance.entryId, entryId))
        yield* tx.delete(similarWords).where(eq(similarWords.entryId, entryId))
        if (judgment.senses.length > 0) {
          yield* tx.insert(senseNuance).values(judgment.senses.map((row) => ({ entryId, ...row, createdAt: now })))
        }
        if (judgment.similar.length > 0) {
          yield* tx.insert(similarWords).values(judgment.similar.map((row) => ({ entryId, ...row })))
        }
      })
    )
    .pipe(Effect.orDie)

  return { senses: judgment.senses.length, similar: judgment.similar.length, inputTokens: judgment.inputTokens }
})
