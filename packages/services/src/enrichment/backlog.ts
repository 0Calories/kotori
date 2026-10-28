import { Database } from "@kotori/db"
import { entries, entryAudio, examples, senseNuance } from "@kotori/db/schema"
import { and, desc, eq, exists, not } from "drizzle-orm"
import { Effect } from "effect"
import type { JobKind } from "./jobs.ts"

/** Whether an entry has a kind of enrichment, as a condition on `entries`. */
const enriched = (db: typeof Database.Service, kind: JobKind) => {
  switch (kind) {
    case "nuance":
      return exists(db.select().from(senseNuance).where(eq(senseNuance.entryId, entries.id)))
    case "examples":
      return exists(db.select().from(examples).where(eq(examples.entryId, entries.id)))
    case "audio":
      return exists(db.select().from(entryAudio).where(eq(entryAudio.entryId, entries.id)))
  }
}

/** Entries still missing a kind of enrichment, most frequent first, for backfills that can resume. */
export const backlog = Effect.fn("enrichment.backlog")(function* (
  kind: JobKind,
  options: { readonly limit: number; readonly commonOnly: boolean }
) {
  const db = yield* Database
  const rows = yield* db
    .select({ id: entries.id })
    .from(entries)
    .where(and(options.commonOnly ? eq(entries.common, true) : undefined, not(enriched(db, kind))))
    .orderBy(desc(entries.priority), entries.id)
    .limit(options.limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

/** How much of the dictionary is enriched: of the common entries, how many have each kind. */
export const coverage = Effect.gen(function* () {
  const db = yield* Database
  const common = eq(entries.common, true)
  const done = (kind: JobKind) => db.$count(entries, and(common, enriched(db, kind)))
  return {
    entries: yield* db.$count(entries),
    common: yield* db.$count(entries, common),
    enriched: { nuance: yield* done("nuance"), examples: yield* done("examples"), audio: yield* done("audio") }
  }
}).pipe(Effect.orDie, Effect.withSpan("enrichment.coverage"))
