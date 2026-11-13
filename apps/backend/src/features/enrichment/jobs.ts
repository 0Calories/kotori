import { type EntryId, jobs } from "@kotori/db"
import { and, asc, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

// The enrichment queue: the API asks for work on an entry someone is looking at, the worker
// claims the most urgent job and settles it. One job per kind and entry.

export type JobKind = (typeof jobs.$inferSelect)["kind"]
export type JobStatus = (typeof jobs.$inferSelect)["status"]

/**
 * A job's lifecycle: every move it makes, the statuses it is made from and the one it leads to.
 * A job in any other status is left as it is. The queries below apply these; none names a status
 * of its own, so a new status or move is added here or nowhere.
 *
 * ```text
 * (no job) ──insert──▶ queued ──claim──▶ running ──complete──▶ done
 *                        ▲                 │ ├────giveUp─────▶ failed
 *                        │                 │ │                  │ │
 *                        ├─retryLater, release, recover─┘       │ │
 *                        └──────────ask, rerun, retry───────────┴─┘ (ask: failed only)
 * ```
 */
const MOVES = {
  /** Someone asks for the work: a job that ran out of attempts gets new ones. */
  ask: { from: ["failed"], to: "queued" },
  /** What the job works from changed (new sentences to voice): a settled job runs again. */
  rerun: { from: ["done", "failed"], to: "queued" },
  /** A settled job that left something missing is tried again. */
  retry: { from: ["done", "failed"], to: "queued" },
  /** The worker takes it. */
  claim: { from: ["queued"], to: "running" },
  /** The worker finished it. */
  complete: { from: ["running"], to: "done" },
  /** It failed with attempts left. */
  retryLater: { from: ["running"], to: "queued" },
  /** It failed on its last attempt. */
  giveUp: { from: ["running"], to: "failed" },
  /** Its worker was stopped mid-job (a deploy). */
  release: { from: ["running"], to: "queued" },
  /** Its worker crashed or was killed and never settled it. */
  recover: { from: ["running"], to: "queued" }
} as const satisfies Record<string, { readonly from: ReadonlyArray<JobStatus>; readonly to: JobStatus }>

type Move = keyof typeof MOVES

/** Whether the job is in a status `move` is made from. */
const can = (move: Move) => inArray(jobs.status, MOVES[move].from)
/** The status `move` leads to, as SQL. */
const to = (move: Move) => sql`${MOVES[move].to}::job_status`
/** The job's status after `move`: where it leads when the job can make it, unchanged otherwise. */
const after = (move: Move) => sql`CASE WHEN ${can(move)} THEN ${to(move)} ELSE ${jobs.status} END`

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

export type Job = Pick<typeof jobs.$inferSelect, keyof typeof jobColumns>

/** Queues work for an entry. Asking again raises its priority and revives a failed job. */
export const enqueueJob = (db: DatabaseShape, kind: JobKind, entryId: EntryId, priority: number, now: Date) =>
  db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: now, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [jobs.kind, jobs.entryId],
      set: {
        priority: sql`greatest(${jobs.priority}, excluded.priority)`,
        status: after("ask"),
        attempts: sql`CASE WHEN ${can("ask")} THEN 0 ELSE ${jobs.attempts} END`,
        runAfter: sql`CASE WHEN ${can("ask")} THEN excluded.run_after ELSE ${jobs.runAfter} END`,
        updatedAt: sql`CASE WHEN ${jobs.status} = 'running' THEN ${jobs.updatedAt} ELSE excluded.updated_at END`
      }
    })
    .pipe(Effect.asVoid, Effect.orDie)

/**
 * Queues work for an entry that has no job of this kind yet, returning whether it did. When
 * another request queued it first, nothing changes and the answer is false.
 */
export const queueNewJob = (db: DatabaseShape, kind: JobKind, entryId: EntryId, priority: number, now: Date) =>
  db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: now, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [jobs.kind, jobs.entryId] })
    .returning({ id: jobs.id })
    .pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie
    )

/** Queues a job to run again even if it already finished (audio, say, once examples exist). */
export const requeueJob = (db: DatabaseShape, kind: JobKind, entryId: EntryId, priority: number, now: Date) =>
  db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: now, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [jobs.kind, jobs.entryId],
      set: {
        priority: sql`excluded.priority`,
        status: after("rerun"),
        attempts: 0,
        runAfter: sql`excluded.run_after`,
        updatedAt: sql`excluded.updated_at`
      }
    })
    .pipe(Effect.asVoid, Effect.orDie)

/**
 * Queues a settled job (`done` or `failed`) again only if it settled before `settledBefore`,
 * so a gap or failure is retried at most once per interval rather than on every request.
 * Returns whether it queued it.
 */
export const refillJob = (
  db: DatabaseShape,
  kind: JobKind,
  entryId: EntryId,
  settledBefore: Date,
  priority: number,
  now: Date
) =>
  db
    .update(jobs)
    .set({ status: MOVES.retry.to, priority, attempts: 0, runAfter: now, updatedAt: now })
    .where(and(eq(jobs.kind, kind), eq(jobs.entryId, entryId), can("retry"), lt(jobs.updatedAt, settledBefore)))
    .returning({ id: jobs.id })
    .pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.orDie
    )

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
    .where(and(can("claim"), inArray(jobs.kind, kinds), lte(jobs.runAfter, now)))
    .orderBy(desc(jobs.priority), asc(jobs.id))
    .limit(1)
    .for("update", { skipLocked: true })
  const rows = yield* db
    .update(jobs)
    .set({ status: MOVES.claim.to, attempts: sql`${jobs.attempts} + 1`, updatedAt: now })
    .where(inArray(jobs.id, next))
    .returning(jobColumns)
    .pipe(Effect.orDie)
  return Option.fromNullishOr(rows[0])
})

export const completeJob = (db: DatabaseShape, id: number, now: Date) =>
  db
    .update(jobs)
    .set({ status: MOVES.complete.to, error: null, updatedAt: now })
    .where(and(eq(jobs.id, id), can("complete")))
    .pipe(Effect.asVoid, Effect.orDie)

/** Records a failure; the job is retried after `retryAt` until it runs out of attempts. */
export const failJob = (db: DatabaseShape, id: number, error: string, retryAt: Date, now: Date) =>
  db
    .update(jobs)
    .set({
      status: sql`CASE WHEN ${jobs.attempts} >= ${MAX_ATTEMPTS} THEN ${to("giveUp")} ELSE ${to("retryLater")} END`,
      error: error.slice(0, 2000),
      runAfter: retryAt,
      updatedAt: now
    })
    .where(and(eq(jobs.id, id), can("giveUp")))
    .pipe(Effect.asVoid, Effect.orDie)

/** Puts a claimed job back in the queue without counting the attempt: its worker stopped, it didn't fail. */
export const releaseJob = (db: DatabaseShape, id: number, now: Date) =>
  db
    .update(jobs)
    .set({ status: MOVES.release.to, attempts: sql`greatest(${jobs.attempts} - 1, 0)`, updatedAt: now })
    .where(and(eq(jobs.id, id), can("release")))
    .pipe(Effect.asVoid, Effect.orDie)

/** Each kind of job's status for an entry. */
export const jobStatusFor = Effect.fn("jobs.statusFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db
    .select({ kind: jobs.kind, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.entryId, entryId))
    .pipe(Effect.orDie)
  return new Map<JobKind, JobStatus>(rows.map((row) => [row.kind, row.status]))
})

/** Puts jobs left `running` by a worker that crashed or was killed back in the queue. */
export const requeueStaleJobs = (db: DatabaseShape, olderThan: Date, now: Date) =>
  db
    .update(jobs)
    .set({ status: MOVES.recover.to, updatedAt: now })
    .where(and(can("recover"), lt(jobs.updatedAt, olderThan)))
    .pipe(Effect.asVoid, Effect.orDie)

/** How many jobs there are of each kind in each status. */
export const jobCounts = (db: DatabaseShape) =>
  db
    .select({ kind: jobs.kind, status: jobs.status, n: count() })
    .from(jobs)
    .groupBy(jobs.kind, jobs.status)
    .pipe(Effect.orDie)
