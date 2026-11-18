import { type EntryId, jobs } from "@kotori/db"
import { and, asc, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

export type JobKind = (typeof jobs.$inferSelect)["kind"]
export type JobStatus = (typeof jobs.$inferSelect)["status"]

const MOVES = {
  ask: { from: ["failed"], to: "queued" },
  rerun: { from: ["done", "failed"], to: "queued" },
  retry: { from: ["done", "failed"], to: "queued" },
  claim: { from: ["queued"], to: "running" },
  complete: { from: ["running"], to: "done" },
  retryLater: { from: ["running"], to: "queued" },
  giveUp: { from: ["running"], to: "failed" },
  release: { from: ["running"], to: "queued" },
  recover: { from: ["running"], to: "queued" }
} as const satisfies Record<string, { readonly from: ReadonlyArray<JobStatus>; readonly to: JobStatus }>

type Move = keyof typeof MOVES

const can = (move: Move) => inArray(jobs.status, MOVES[move].from)
const to = (move: Move) => sql`${MOVES[move].to}::job_status`
const after = (move: Move) => sql`CASE WHEN ${can(move)} THEN ${to(move)} ELSE ${jobs.status} END`

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
        // Preserve updatedAt while running because requeueStaleJobs uses it as the claim timestamp.
        updatedAt: sql`CASE WHEN ${jobs.status} = 'running' THEN ${jobs.updatedAt} ELSE excluded.updated_at END`
      }
    })
    .pipe(Effect.asVoid, Effect.orDie)

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

export const releaseJob = (db: DatabaseShape, id: number, now: Date) =>
  db
    .update(jobs)
    .set({ status: MOVES.release.to, attempts: sql`greatest(${jobs.attempts} - 1, 0)`, updatedAt: now })
    .where(and(eq(jobs.id, id), can("release")))
    .pipe(Effect.asVoid, Effect.orDie)

export const jobStatusFor = Effect.fn("jobs.statusFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db
    .select({ kind: jobs.kind, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.entryId, entryId))
    .pipe(Effect.orDie)
  return new Map<JobKind, JobStatus>(rows.map((row) => [row.kind, row.status]))
})

export const requeueStaleJobs = (db: DatabaseShape, olderThan: Date, now: Date) =>
  db
    .update(jobs)
    .set({ status: MOVES.recover.to, updatedAt: now })
    .where(and(can("recover"), lt(jobs.updatedAt, olderThan)))
    .pipe(Effect.asVoid, Effect.orDie)

export const jobCounts = (db: DatabaseShape) =>
  db
    .select({ kind: jobs.kind, status: jobs.status, n: count() })
    .from(jobs)
    .groupBy(jobs.kind, jobs.status)
    .pipe(Effect.orDie)
