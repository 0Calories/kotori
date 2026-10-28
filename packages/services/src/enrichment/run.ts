import { Claude } from "@kotori/ai"
import { at, Database } from "@kotori/db"
import { jobs } from "@kotori/db/schema"
import { Jev } from "@kotori/nuance"
import { ElevenLabs } from "@kotori/tts"
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm"
import { Cause, Clock, Effect, Exit, Option } from "effect"
import { voiceEntry } from "./audio.ts"
import { writeExamples } from "./examples.ts"
import type { JobKind } from "./jobs.ts"
import { judgeNuance } from "./nuance.ts"

/** Attempts before a job is marked failed for good. */
const MAX_ATTEMPTS = 3
/** First wait before retrying a failed job; it doubles with each attempt. */
const RETRY_AFTER = 30_000

/** Which kinds of enrichment have a configured provider. */
export const available = Effect.gen(function* () {
  const kinds: Array<JobKind> = []
  if ((yield* Jev).configured) kinds.push("nuance")
  if (yield* (yield* Claude).available) kinds.push("examples")
  if ((yield* ElevenLabs).configured) kinds.push("audio")
  return kinds
})

/** Runs one kind of enrichment for an entry, returning a short description of what was done. */
export const run = (kind: JobKind, entryId: number) =>
  Effect.gen(function* () {
    switch (kind) {
      case "nuance": {
        const done = yield* judgeNuance(entryId)
        return `${done.senses} senses, ${done.similar} similar words, ${done.inputTokens} tokens`
      }
      case "examples":
        return `${(yield* writeExamples(entryId)).examples} examples`
      case "audio": {
        const done = yield* voiceEntry(entryId)
        return `${done.clips} clips, ${done.characters} chars`
      }
    }
  })

const jobColumns = {
  id: jobs.id,
  kind: jobs.kind,
  entryId: jobs.entryId,
  priority: jobs.priority,
  attempts: jobs.attempts
}

/** Atomically takes the most urgent runnable job of the given kinds. */
const claim = Effect.fn("enrichment.claim")(function* (kinds: ReadonlyArray<JobKind>, now: number) {
  const db = yield* Database
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

/** Queues a job to run again even though it finished: audio, once there are new examples to voice. */
const requeue = Effect.fn("enrichment.requeue")(function* (
  kind: JobKind,
  entryId: number,
  priority: number,
  now: number
) {
  const db = yield* Database
  yield* db
    .insert(jobs)
    .values({ kind, entryId, priority, status: "queued", runAfter: at(now), createdAt: at(now), updatedAt: at(now) })
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
}, Effect.orDie)

const complete = Effect.fn("enrichment.complete")(function* (id: number, now: number) {
  const db = yield* Database
  yield* db
    .update(jobs)
    .set({ status: "done", error: null, updatedAt: at(now) })
    .where(eq(jobs.id, id))
}, Effect.orDie)

/** Records a failure; the job is retried after `retryAt` until it runs out of attempts. */
const fail = Effect.fn("enrichment.fail")(function* (id: number, error: string, retryAt: number, now: number) {
  const db = yield* Database
  yield* db
    .update(jobs)
    .set({
      status: sql`CASE WHEN ${jobs.attempts} >= ${MAX_ATTEMPTS} THEN 'failed'::job_status ELSE 'queued'::job_status END`,
      error: error.slice(0, 2000),
      runAfter: at(retryAt),
      updatedAt: at(now)
    })
    .where(eq(jobs.id, id))
}, Effect.orDie)

/** Puts a claimed job back without counting the attempt: its worker stopped, it didn't fail. */
const release = Effect.fn("enrichment.release")(function* (id: number, now: number) {
  const db = yield* Database
  yield* db
    .update(jobs)
    .set({ status: "queued", attempts: sql`greatest(${jobs.attempts} - 1, 0)`, updatedAt: at(now) })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
}, Effect.orDie)

/**
 * Claims the most urgent runnable job of the given kinds, runs it and settles it. Succeeds
 * with whether there was a job, so a loop knows when to wait. Only the enrichment itself is
 * interruptible, so every claimed job is settled: on shutdown (SIGTERM during a deploy) an
 * interrupted job goes back in the queue instead of staying `running`.
 */
export const claimAndRun = Effect.fn("enrichment.claimAndRun")(function* (kinds: ReadonlyArray<JobKind>) {
  if (kinds.length === 0) return false
  const claimed = yield* claim(kinds, yield* Clock.currentTimeMillis)
  if (Option.isNone(claimed)) return false
  const { id, kind, entryId, priority, attempts } = claimed.value

  yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(restore(run(kind, entryId)))
      const finished = yield* Clock.currentTimeMillis
      if (Exit.isSuccess(exit)) {
        yield* complete(id, finished)
        yield* Effect.logInfo(`${kind} ${entryId}: ${exit.value}`)
        // New example sentences need voicing too.
        if (kind === "examples" && kinds.includes("audio")) yield* requeue("audio", entryId, priority, finished)
      } else if (Cause.hasInterrupts(exit.cause)) {
        yield* release(id, finished)
        yield* Effect.logInfo(`${kind} ${entryId}: interrupted, back in the queue`)
      } else {
        yield* fail(id, String(Cause.squash(exit.cause)), finished + RETRY_AFTER * 2 ** attempts, finished)
        yield* Effect.logWarning(`${kind} ${entryId} failed (attempt ${attempts})`, exit.cause)
      }
    })
  )
  return true
})
