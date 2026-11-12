import { Claude, Pronouncer } from "@kotori/ai"
import { type Enrichment, type EnrichmentStatus, type EntryRecord, RateLimited } from "@kotori/contracts"
import type { UserId } from "@kotori/db"
import { Clock, Config, Effect, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { scopedToUser } from "../../db/scopedToUser.ts"
import { entryClips, exampleClips } from "../audio/index.ts"
import { reserveUsage } from "../coaching/queries.ts"
import type { ExampleRow, JobKind } from "../enrichment/index.ts"
import {
  enqueueJob,
  examplesFor,
  examplesToCome,
  jobStatusFor,
  judgedCasting,
  queueNewJob,
  refillJob,
  sentencesToVoice
} from "../enrichment/index.ts"

// Whether an entry's example sentences and audio are ready, and queuing what it lacks when a
// learner asks, within their allowance. The dictionary's only use of the AI providers: whether
// Claude can write sentences and the speech provider voice them.

/** Priority for work requested by someone looking at an entry, above any batch backfill. */
const ON_DEMAND = 1_000

/** How long a finished job that left gaps waits before it is tried again. */
const REFILL_AFTER = 60 * 60 * 1000
/** How long after a job ran out of attempts a request for the entry gives it another try. */
const RETRY_AFTER = 10 * 60 * 1000

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** An entry's enrichment status, and requests for what it lacks, on the application database. */
export const makeEnrichmentStatus = Effect.gen(function* () {
  const db = yield* Database
  const claude = yield* Claude
  const pronouncer = yield* Pronouncer
  const examplesHourly = yield* Config.Int("KOTORI_ENRICH_HOURLY_LIMIT").pipe(Config.withDefault(60))
  const examplesDaily = yield* Config.Int("KOTORI_ENRICH_DAILY_LIMIT").pipe(Config.withDefault(300))

  // A job that settled (`done` or `failed`) is not on its way, so whatever it left missing is
  // `unavailable` and the app stops polling. Asking again may queue it anew (see `requestFor`).
  const status = (ready: boolean, available: boolean, job: string | undefined): EnrichmentStatus =>
    ready ? "ready" : !available || job === "failed" || job === "done" ? "unavailable" : "queued"

  /**
   * Takes one of the learner's example-sentence requests, or fails when they've used them up.
   * Called inside the transaction that queues the work, so a refused request queues nothing.
   */
  const reserveExamples = Effect.fnUntraced(function* (userId: UserId, now: Date) {
    const hour = { since: new Date(now.getTime() - HOUR), limit: examplesHourly }
    const day = { since: new Date(now.getTime() - DAY), limit: examplesDaily }
    const full = yield* reserveUsage(scopedToUser(db, userId), {
      kind: "examples",
      kinds: ["examples"],
      windows: [hour, day],
      now
    })
    if (Option.isNone(full)) return
    return yield* full.value === day
      ? new RateLimited({
          message: "That's a lot of new words for one day. More examples tomorrow!",
          retryAfterSeconds: 3600
        })
      : new RateLimited({
          message: "That's a lot of new words this hour. Take a breather!",
          retryAfterSeconds: 600
        })
  })

  /** What an entry has and what is on its way, read without writing anything. */
  const lookAt = Effect.fnUntraced(function* (entry: Pick<EntryRecord, "id" | "language">) {
    const examples = yield* examplesFor(db, [entry.id])
    // Sentences seeded from Tatoeba or Wiktionary don't stand in for Kotori's, which are
    // written for learners: Claude still writes them for a requested word.
    const hasExamples = examples.some((example) => example.source === "kotori")
    const jobs = yield* jobStatusFor(db, entry.id)
    // The sentences that get audio: Kotori's, and seeded ones only where Kotori wrote none.
    const toVoice = sentencesToVoice(examples, { writing: examplesToCome(jobs.get("examples"), examples) })
    const clips = yield* exampleClips(
      db,
      examples.map((example) => example.id)
    )
    // Ready once the headword and every sentence to voice that can be are, in the entry's
    // language. A seeded sentence has no formality to cast a voice by until Jev judges it on the
    // audio job; without Jev it is never voiced, as no register is assumed, so it isn't waited
    // for, and nor is one Jev judged and declined to give a formality.
    const voiceable = (example: ExampleRow) =>
      example.formality !== null || (pronouncer.judges && !judgedCasting(example))
    const unvoiced = toVoice.filter((example) => voiceable(example) && !clips.has(`${example.id}:${entry.language}`))
    const hasAudio = (yield* entryClips(db, [entry.id])).size > 0 && unvoiced.length === 0
    const coachAvailable = yield* claude.available
    return { hasExamples, hasAudio, unvoiced, coachAvailable, jobs }
  })

  const statusOf = (
    look: Effect.Success<ReturnType<typeof lookAt>>,
    jobs: ReadonlyMap<JobKind, string>
  ): Enrichment => ({
    examples: status(look.hasExamples, look.coachAvailable, jobs.get("examples")),
    audio: status(look.hasAudio, pronouncer.configured, jobs.get("audio"))
  })

  /** An entry's enrichment status. Reads only; never queues work. */
  const enrichmentOf = (entry: Pick<EntryRecord, "id" | "language">) =>
    Effect.map(lookAt(entry), (look) => statusOf(look, look.jobs))

  /**
   * Queues whatever enrichment an entry is missing, for `requester`, and returns its status.
   * Queuing Kotori's example sentences anew (a new job, or a settled one tried again) takes
   * one of the requester's allowance; a job already on its way takes none, and nor does
   * audio, which has its own budget.
   */
  const requestFor = Effect.fnUntraced(function* (entry: Pick<EntryRecord, "id" | "language">, requester: UserId) {
    const look = yield* lookAt(entry)
    const { hasExamples, hasAudio, unvoiced, coachAvailable, jobs: before } = look
    const now = new Date(yield* Clock.currentTimeMillis)
    const retryWindow = new Date(now.getTime() - RETRY_AFTER)
    const refillWindow = new Date(now.getTime() - REFILL_AFTER)
    // Only called for data the entry lacks. A job that settled without supplying it stays
    // settled while the entry is polled, so its status reports `unavailable` and the app stops
    // polling; a later request gives it a new try: after ten minutes for a job that ran out of
    // attempts, after an hour for one that finished with a gap (nothing judged, no sentence
    // kept, a clip the worker can't fill). Enqueueing a settled job would only touch it.
    // Succeeds with whether it queued work that wasn't on its way.
    const queueOrRetry = (kind: JobKind): Effect.Effect<boolean> => {
      switch (before.get(kind)) {
        case "failed":
          return refillJob(db, kind, entry.id, retryWindow, ON_DEMAND, now)
        case "done":
          return refillJob(db, kind, entry.id, refillWindow, ON_DEMAND, now)
        case undefined:
          // Another request may have queued it since: then it's theirs, raised to on demand.
          return Effect.flatMap(queueNewJob(db, kind, entry.id, ON_DEMAND, now), (queued) =>
            queued ? Effect.succeed(true) : Effect.as(enqueueJob(db, kind, entry.id, ON_DEMAND, now), false)
          )
        default:
          // Already on its way (perhaps from a backfill): asking only raises its priority.
          return Effect.as(enqueueJob(db, kind, entry.id, ON_DEMAND, now), false)
      }
    }

    // Whoever causes Claude to write an entry's sentences is charged for them, once; when
    // their allowance is used up, the transaction rolls back and nothing is queued.
    if (!hasExamples && coachAvailable)
      yield* db
        .transaction(() =>
          Effect.gen(function* () {
            if (yield* queueOrRetry("examples")) yield* reserveExamples(requester, now)
          })
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    // The worker re-runs audio when Kotori's sentences are written, so they get voiced too. A
    // finished job runs again only for a sentence it hasn't tried: one written since it ran,
    // or one no run has judged (seeded since, or from before seeded sentences were voiced),
    // the latter at most once an hour. A sentence a run tried and couldn't voice (no voice
    // fits it, or Jev judged it and gave no formality) isn't retried on every request.
    if (!hasAudio && pronouncer.configured) {
      if (before.get("audio") !== "done") {
        yield* queueOrRetry("audio")
      } else {
        const untried = Math.max(
          ...unvoiced.map((example) =>
            example.formality === null ? now.getTime() - REFILL_AFTER : example.createdAt.getTime()
          )
        )
        // Enqueueing a finished job would touch it, putting its next try off with every request.
        if (unvoiced.length > 0) yield* refillJob(db, "audio", entry.id, new Date(untried), ON_DEMAND, now)
      }
    }

    return statusOf(look, yield* jobStatusFor(db, entry.id))
  })

  return { enrichmentOf, requestFor }
})
