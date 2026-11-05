import { type EntryId, jobs, type UserId } from "@kotori/db"
import { and, asc, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

// The enrichment queue: the API asks for work on an entry someone is looking at, the worker
// claims the most urgent job and settles it. One job per kind and entry.

export type JobKind = (typeof jobs.$inferSelect)["kind"]

/** Attempts before a job is marked failed for good. */
const MAX_ATTEMPTS = 3

const jobColumns = {
  id: jobs.id,
  kind: jobs.kind,
  entryId: jobs.entryId,
  priority: jobs.priority,
  status: jobs.status,
  attempts: jobs.attempts,
  error: jobs.error,
  requestedBy: jobs.requestedBy
}

export type Job = Pick<typeof jobs.$inferSelect, keyof typeof jobColumns>

/**
 * Queues work for an entry. Asking again raises its priority and revives a failed job, which
 * then counts toward the reviver's audio allowance (`requestedBy`; null for an admin or the CLI).
 */
export const enqueueJob = (
  db: DatabaseShape,
  kind: JobKind,
  entryId: EntryId,
  priority: number,
  now: Date,
  requestedBy: UserId | null
) =>
  db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: now, createdAt: now, updatedAt: now, requestedBy })
    .onConflictDoUpdate({
      target: [jobs.kind, jobs.entryId],
      set: {
        priority: sql`greatest(${jobs.priority}, excluded.priority)`,
        requestedBy: sql`CASE WHEN ${jobs.status} = 'failed' THEN excluded.requested_by ELSE ${jobs.requestedBy} END`,
        status: sql`CASE WHEN ${jobs.status} = 'failed' THEN 'queued'::job_status ELSE ${jobs.status} END`,
        attempts: sql`CASE WHEN ${jobs.status} = 'failed' THEN 0 ELSE ${jobs.attempts} END`,
        runAfter: sql`CASE WHEN ${jobs.status} = 'failed' THEN excluded.run_after ELSE ${jobs.runAfter} END`,
        updatedAt: sql`CASE WHEN ${jobs.status} = 'running' THEN ${jobs.updatedAt} ELSE excluded.updated_at END`
      }
    })
    .pipe(Effect.asVoid, Effect.orDie)

/** Queues a job to run again even if it already finished (audio, say, once examples exist). */
export const requeueJob = (
  db: DatabaseShape,
  kind: JobKind,
  entryId: EntryId,
  priority: number,
  now: Date,
  requestedBy: UserId | null
) =>
  db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: now, createdAt: now, updatedAt: now, requestedBy })
    .onConflictDoUpdate({
      target: [jobs.kind, jobs.entryId],
      set: {
        priority: sql`excluded.priority`,
        requestedBy: sql`excluded.requested_by`,
        status: sql`CASE WHEN ${jobs.status} = 'running' THEN ${jobs.status} ELSE 'queued'::job_status END`,
        attempts: 0,
        runAfter: sql`excluded.run_after`,
        updatedAt: sql`excluded.updated_at`
      }
    })
    .pipe(Effect.asVoid, Effect.orDie)

/**
 * Queues a settled job (`done` or `failed`) again only if it settled before `settledBefore`,
 * so a gap or failure is retried at most once per interval rather than on every poll.
 */
export const refillJob = (
  db: DatabaseShape,
  kind: JobKind,
  entryId: EntryId,
  settledBefore: Date,
  priority: number,
  now: Date,
  requestedBy: UserId | null
) =>
  db
    .update(jobs)
    .set({ status: "queued", priority, attempts: 0, runAfter: now, updatedAt: now, requestedBy })
    .where(
      and(
        eq(jobs.kind, kind),
        eq(jobs.entryId, entryId),
        inArray(jobs.status, ["done", "failed"]),
        lt(jobs.updatedAt, settledBefore)
      )
    )
    .pipe(Effect.asVoid, Effect.orDie)

/** Atomically takes the most urgent runnable job of the given kinds. */
export const claimJob = Effect.fn("jobs.claim")(function* (
  db: DatabaseShape,
  kinds: ReadonlyArray<JobKind>,
  now: Date
) {
  if (kinds.length === 0) return Option.none<Job>()
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), inArray(jobs.kind, kinds), lte(jobs.runAfter, now)))
    .orderBy(desc(jobs.priority), asc(jobs.id))
    .limit(1)
    .for("update", { skipLocked: true })
  const rows = yield* db
    .update(jobs)
    .set({ status: "running", attempts: sql`${jobs.attempts} + 1`, updatedAt: now })
    .where(inArray(jobs.id, next))
    .returning(jobColumns)
    .pipe(Effect.orDie)
  return Option.fromNullishOr(rows[0])
})

export const completeJob = (db: DatabaseShape, id: number, now: Date) =>
  db
    .update(jobs)
    .set({ status: "done", error: null, updatedAt: now })
    .where(eq(jobs.id, id))
    .pipe(Effect.asVoid, Effect.orDie)

/** Records a failure; the job is retried after `retryAt` until it runs out of attempts. */
export const failJob = (db: DatabaseShape, id: number, error: string, retryAt: Date, now: Date) =>
  db
    .update(jobs)
    .set({
      status: sql`CASE WHEN ${jobs.attempts} >= ${MAX_ATTEMPTS} THEN 'failed'::job_status ELSE 'queued'::job_status END`,
      error: error.slice(0, 2000),
      runAfter: retryAt,
      updatedAt: now
    })
    .where(eq(jobs.id, id))
    .pipe(Effect.asVoid, Effect.orDie)

/** Puts a claimed job back in the queue without counting the attempt: its worker stopped, it didn't fail. */
export const releaseJob = (db: DatabaseShape, id: number, now: Date) =>
  db
    .update(jobs)
    .set({ status: "queued", attempts: sql`greatest(${jobs.attempts} - 1, 0)`, updatedAt: now })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
    .pipe(Effect.asVoid, Effect.orDie)

/** Each kind of job's status for an entry, and when it last changed. */
export const jobsFor = Effect.fn("jobs.jobsFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db
    .select({ kind: jobs.kind, status: jobs.status, updatedAt: jobs.updatedAt })
    .from(jobs)
    .where(eq(jobs.entryId, entryId))
    .pipe(Effect.orDie)
  return new Map(rows.map(({ kind, ...job }) => [kind, job]))
})

/** Each kind of job's status for an entry. */
export const jobStatusFor = Effect.fn("jobs.statusFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* jobsFor(db, entryId)
  return new Map([...rows].map(([kind, job]) => [kind, job.status]))
})

/** Puts jobs left `running` by a worker that crashed or was killed back in the queue. */
export const requeueStaleJobs = (db: DatabaseShape, olderThan: Date, now: Date) =>
  db
    .update(jobs)
    .set({ status: "queued", updatedAt: now })
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, olderThan)))
    .pipe(Effect.asVoid, Effect.orDie)

/** How many jobs there are of each kind in each status. */
export const jobCounts = (db: DatabaseShape) =>
  db
    .select({ kind: jobs.kind, status: jobs.status, n: count() })
    .from(jobs)
    .groupBy(jobs.kind, jobs.status)
    .pipe(Effect.orDie)
