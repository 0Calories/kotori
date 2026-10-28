import { at, Database } from "@kotori/db"
import { type jobKind, jobs } from "@kotori/db/schema"
import { and, count, eq, lt, sql } from "drizzle-orm"
import { Clock, Effect } from "effect"

// The enrichment queue, shared by the API (work requested by someone looking at an entry)
// and the worker. One job per kind and entry; claiming and settling are in `./run.ts`.

/** Enrichment an entry can be missing: Jev's nuance, Claude's examples, ElevenLabs' audio. */
export type JobKind = (typeof jobKind.enumValues)[number]

/** A job still `running` this long after its claim belongs to a worker that crashed or was killed. */
const STALE_AFTER = 10 * 60_000

/** Queues work for an entry. Re-queueing raises priority and revives failed jobs. */
export const enqueue = Effect.fn("enrichment.enqueue")(function* (kind: JobKind, entryId: number, priority: number) {
  const db = yield* Database
  const now = at(yield* Clock.currentTimeMillis)
  yield* db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: now, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [jobs.kind, jobs.entryId],
      set: {
        priority: sql`greatest(${jobs.priority}, excluded.priority)`,
        status: sql`CASE WHEN ${jobs.status} = 'failed' THEN 'queued'::job_status ELSE ${jobs.status} END`,
        attempts: sql`CASE WHEN ${jobs.status} = 'failed' THEN 0 ELSE ${jobs.attempts} END`,
        updatedAt: sql`excluded.updated_at`
      }
    })
}, Effect.orDie)

/** Where each kind of enrichment stands for an entry, for kinds that were ever queued. */
export const statusFor = Effect.fn("enrichment.statusFor")(function* (entryId: number) {
  const db = yield* Database
  const rows = yield* db.select({ kind: jobs.kind, status: jobs.status }).from(jobs).where(eq(jobs.entryId, entryId))
  return new Map(rows.map((row) => [row.kind, row.status]))
}, Effect.orDie)

/** Puts jobs left `running` by a worker that crashed or was killed back in the queue. */
export const requeueStale = Effect.gen(function* () {
  const db = yield* Database
  const now = yield* Clock.currentTimeMillis
  yield* db
    .update(jobs)
    .set({ status: "queued", updatedAt: at(now) })
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, at(now - STALE_AFTER))))
}).pipe(Effect.orDie, Effect.withSpan("enrichment.requeueStale"))

/** Jobs by kind and status, for `kotori status`. */
export const jobCounts = Effect.gen(function* () {
  const db = yield* Database
  return yield* db
    .select({ kind: jobs.kind, status: jobs.status, n: count() })
    .from(jobs)
    .groupBy(jobs.kind, jobs.status)
}).pipe(Effect.orDie, Effect.withSpan("enrichment.jobCounts"))
