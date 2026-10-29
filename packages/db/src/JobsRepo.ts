import { and, asc, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at } from "./rows.ts"
import { jobKind, jobs, jobStatus } from "./schema/index.ts"

export type JobKind = (typeof jobKind.enumValues)[number]
export type JobStatus = (typeof jobStatus.enumValues)[number]

export interface Job {
  readonly id: number
  readonly kind: JobKind
  readonly entryId: number
  readonly priority: number
  readonly status: JobStatus
  readonly attempts: number
  readonly error: string | null
}

/** Attempts before a job is marked failed for good. */
const MAX_ATTEMPTS = 3

const jobColumns = {
  id: jobs.id,
  kind: jobs.kind,
  entryId: jobs.entryId,
  priority: jobs.priority,
  status: jobs.status,
  attempts: jobs.attempts,
  error: jobs.error
}

export class JobsRepo extends Context.Service<
  JobsRepo,
  {
    /** Queues work for an entry. Re-queueing raises priority and revives failed jobs. */
    enqueue(kind: JobKind, entryId: number, priority: number, now: number): Effect.Effect<void>
    /** Queues a job to run again even if it already finished (e.g. audio once examples exist). */
    requeue(kind: JobKind, entryId: number, priority: number, now: number): Effect.Effect<void>
    /**
     * Queues a finished job again only if it finished before `finishedBefore`, so a gap the job
     * can't fill is retried at most once per interval.
     */
    refill(kind: JobKind, entryId: number, finishedBefore: number, priority: number, now: number): Effect.Effect<void>
    /** Atomically takes the most urgent runnable job of the given kinds. */
    claim(kinds: ReadonlyArray<JobKind>, now: number): Effect.Effect<Option.Option<Job>>
    complete(id: number, now: number): Effect.Effect<void>
    /** Records a failure; the job is retried after `retryAt` until it runs out of attempts. */
    fail(id: number, error: string, retryAt: number, now: number): Effect.Effect<void>
    /** Puts a claimed job back in the queue without counting the attempt: its worker stopped, it didn't fail. */
    release(id: number, now: number): Effect.Effect<void>
    statusFor(entryId: number): Effect.Effect<ReadonlyMap<JobKind, JobStatus>>
    /** Puts jobs left `running` by a worker that crashed or was killed back in the queue. */
    requeueStale(olderThan: number, now: number): Effect.Effect<void>
    readonly counts: Effect.Effect<ReadonlyArray<{ kind: JobKind; status: JobStatus; n: number }>>
  }
>()("@kotori/db/JobsRepo") {
  static readonly layer = Layer.effect(
    JobsRepo,
    Effect.gen(function* () {
      const db = yield* Database

      const enqueue = (kind: JobKind, entryId: number, priority: number, now: number) =>
        db
          .insert(jobs)
          .values({
            kind,
            entryId,
            priority,
            status: "queued",
            runAfter: at(now),
            createdAt: at(now),
            updatedAt: at(now)
          })
          .onConflictDoUpdate({
            target: [jobs.kind, jobs.entryId],
            set: {
              priority: sql`greatest(${jobs.priority}, excluded.priority)`,
              status: sql`CASE WHEN ${jobs.status} = 'failed' THEN 'queued'::job_status ELSE ${jobs.status} END`,
              attempts: sql`CASE WHEN ${jobs.status} = 'failed' THEN 0 ELSE ${jobs.attempts} END`,
              updatedAt: sql`excluded.updated_at`
            }
          })
          .pipe(Effect.asVoid, Effect.orDie)

      const requeue = (kind: JobKind, entryId: number, priority: number, now: number) =>
        db
          .insert(jobs)
          .values({
            kind,
            entryId,
            priority,
            status: "queued",
            runAfter: at(now),
            createdAt: at(now),
            updatedAt: at(now)
          })
          .onConflictDoUpdate({
            target: [jobs.kind, jobs.entryId],
            set: {
              priority: sql`excluded.priority`,
              status: sql`CASE WHEN ${jobs.status} = 'running' THEN ${jobs.status} ELSE 'queued'::job_status END`,
              attempts: 0,
              runAfter: sql`excluded.run_after`,
              updatedAt: sql`excluded.updated_at`
            }
          })
          .pipe(Effect.asVoid, Effect.orDie)

      const refill = (kind: JobKind, entryId: number, finishedBefore: number, priority: number, now: number) =>
        db
          .update(jobs)
          .set({ status: "queued", priority, attempts: 0, runAfter: at(now), updatedAt: at(now) })
          .where(
            and(
              eq(jobs.kind, kind),
              eq(jobs.entryId, entryId),
              eq(jobs.status, "done"),
              lt(jobs.updatedAt, at(finishedBefore))
            )
          )
          .pipe(Effect.asVoid, Effect.orDie)

      const claim = Effect.fn("JobsRepo.claim")(function* (kinds: ReadonlyArray<JobKind>, now: number) {
        if (kinds.length === 0) return Option.none<Job>()
        const next = db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.status, "queued"), inArray(jobs.kind, kinds), lte(jobs.runAfter, at(now))))
          .orderBy(desc(jobs.priority), asc(jobs.id))
          .limit(1)
          .for("update", { skipLocked: true })
        const rows = yield* db
          .update(jobs)
          .set({ status: "running", attempts: sql`${jobs.attempts} + 1`, updatedAt: at(now) })
          .where(inArray(jobs.id, next))
          .returning(jobColumns)
        return Option.fromNullishOr(rows[0])
      }, Effect.orDie)

      const complete = (id: number, now: number) =>
        db
          .update(jobs)
          .set({ status: "done", error: null, updatedAt: at(now) })
          .where(eq(jobs.id, id))
          .pipe(Effect.asVoid, Effect.orDie)

      const fail = (id: number, error: string, retryAt: number, now: number) =>
        db
          .update(jobs)
          .set({
            status: sql`CASE WHEN ${jobs.attempts} >= ${MAX_ATTEMPTS} THEN 'failed'::job_status ELSE 'queued'::job_status END`,
            error: error.slice(0, 2000),
            runAfter: at(retryAt),
            updatedAt: at(now)
          })
          .where(eq(jobs.id, id))
          .pipe(Effect.asVoid, Effect.orDie)

      const release = (id: number, now: number) =>
        db
          .update(jobs)
          .set({ status: "queued", attempts: sql`greatest(${jobs.attempts} - 1, 0)`, updatedAt: at(now) })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
          .pipe(Effect.asVoid, Effect.orDie)

      const statusFor = Effect.fn("JobsRepo.statusFor")(function* (entryId: number) {
        const rows = yield* db
          .select({ kind: jobs.kind, status: jobs.status })
          .from(jobs)
          .where(eq(jobs.entryId, entryId))
        return new Map(rows.map((row) => [row.kind, row.status]))
      }, Effect.orDie)

      const requeueStale = (olderThan: number, now: number) =>
        db
          .update(jobs)
          .set({ status: "queued", updatedAt: at(now) })
          .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, at(olderThan))))
          .pipe(Effect.asVoid, Effect.orDie)

      const counts = db
        .select({ kind: jobs.kind, status: jobs.status, n: count() })
        .from(jobs)
        .groupBy(jobs.kind, jobs.status)
        .pipe(Effect.orDie)

      return JobsRepo.of({ enqueue, requeue, refill, claim, complete, fail, release, statusFor, requeueStale, counts })
    })
  )
}
