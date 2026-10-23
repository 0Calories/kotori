import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

export const JobKind = Schema.Literals(["nuance", "examples", "audio"])
export type JobKind = typeof JobKind.Type

export const JobStatus = Schema.Literals(["queued", "running", "done", "failed"])
export type JobStatus = typeof JobStatus.Type

const Job = Schema.Struct({
  id: Schema.Int,
  kind: JobKind,
  entryId: Schema.Int,
  priority: Schema.Int,
  status: JobStatus,
  attempts: Schema.Int,
  error: Schema.NullOr(Schema.String)
})
export type Job = typeof Job.Type

const StatusRow = Schema.Struct({ kind: JobKind, status: JobStatus })
const CountRow = Schema.Struct({ kind: JobKind, status: JobStatus, n: Schema.Int })

const decodeRows = <S extends Schema.Constraint>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

/** Attempts before a job is marked failed for good. */
const MAX_ATTEMPTS = 3

export class JobsRepo extends Context.Service<
  JobsRepo,
  {
    /** Queues work for an entry. Re-queueing raises priority and revives failed jobs. */
    enqueue(kind: JobKind, entryId: number, priority: number, now: number): Effect.Effect<void>
    /** Queues a job to run again even if it already finished (e.g. audio once examples exist). */
    requeue(kind: JobKind, entryId: number, priority: number, now: number): Effect.Effect<void>
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
      const sql = yield* SqlClient.SqlClient

      const enqueue = (kind: JobKind, entryId: number, priority: number, now: number) =>
        sql`
          INSERT INTO jobs (kind, entry_id, priority, status, created_at, updated_at)
          VALUES (${kind}, ${entryId}, ${priority}, 'queued', ${now}, ${now})
          ON CONFLICT (kind, entry_id) DO UPDATE SET
            priority = greatest(jobs.priority, excluded.priority),
            status = CASE WHEN jobs.status = 'failed' THEN 'queued' ELSE jobs.status END,
            attempts = CASE WHEN jobs.status = 'failed' THEN 0 ELSE jobs.attempts END,
            updated_at = excluded.updated_at
        `.pipe(Effect.asVoid, Effect.orDie)

      const requeue = (kind: JobKind, entryId: number, priority: number, now: number) =>
        sql`
          INSERT INTO jobs (kind, entry_id, priority, status, created_at, updated_at)
          VALUES (${kind}, ${entryId}, ${priority}, 'queued', ${now}, ${now})
          ON CONFLICT (kind, entry_id) DO UPDATE SET
            priority = excluded.priority,
            status = CASE WHEN jobs.status = 'running' THEN jobs.status ELSE 'queued' END,
            attempts = 0,
            run_after = 0,
            updated_at = excluded.updated_at
        `.pipe(Effect.asVoid, Effect.orDie)

      const claim = Effect.fn("JobsRepo.claim")(function* (kinds: ReadonlyArray<JobKind>, now: number) {
        if (kinds.length === 0) return Option.none()
        const rows = yield* sql`
          UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ${now}
          WHERE id = (
            SELECT id FROM jobs
            WHERE status = 'queued' AND kind IN ${sql.in(kinds)} AND run_after <= ${now}
            ORDER BY priority DESC, id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id, kind, entry_id, priority, status, attempts, error
        `.pipe(Effect.flatMap(decodeRows(Job)))
        return Option.fromNullishOr(rows[0])
      }, Effect.orDie)

      const complete = (id: number, now: number) =>
        sql`UPDATE jobs SET status = 'done', error = NULL, updated_at = ${now} WHERE id = ${id}`.pipe(
          Effect.asVoid,
          Effect.orDie
        )

      const fail = (id: number, error: string, retryAt: number, now: number) =>
        sql`
          UPDATE jobs SET
            status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
            error = ${error.slice(0, 2000)},
            run_after = ${retryAt},
            updated_at = ${now}
          WHERE id = ${id}
        `.pipe(Effect.asVoid, Effect.orDie)

      const release = (id: number, now: number) =>
        sql`
          UPDATE jobs SET status = 'queued', attempts = greatest(attempts - 1, 0), updated_at = ${now}
          WHERE id = ${id} AND status = 'running'
        `.pipe(Effect.asVoid, Effect.orDie)

      const statusFor = Effect.fn("JobsRepo.statusFor")(function* (entryId: number) {
        const rows = yield* sql`SELECT kind, status FROM jobs WHERE entry_id = ${entryId}`.pipe(
          Effect.flatMap(decodeRows(StatusRow))
        )
        return new Map(rows.map((row) => [row.kind, row.status]))
      }, Effect.orDie)

      const requeueStale = (olderThan: number, now: number) =>
        sql`
          UPDATE jobs SET status = 'queued', updated_at = ${now}
          WHERE status = 'running' AND updated_at < ${olderThan}
        `.pipe(Effect.asVoid, Effect.orDie)

      const counts = sql`SELECT kind, status, count(*) AS n FROM jobs GROUP BY kind, status`.pipe(
        Effect.flatMap(decodeRows(CountRow)),
        Effect.orDie
      )

      return JobsRepo.of({ enqueue, requeue, claim, complete, fail, release, statusFor, requeueStale, counts })
    })
  )
}
