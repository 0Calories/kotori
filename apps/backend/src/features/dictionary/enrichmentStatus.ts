import { Claude, Pronouncer } from "@kotori/ai"
import { type Enrichment, type EnrichmentStatus, type EntryRecord, RateLimited } from "@kotori/contracts"
import type { UserId } from "@kotori/db"
import { Clock, Config, Effect, Match, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { scopedToUser } from "../../db/scopedToUser.ts"
import { entryClips, exampleClips } from "../audio/index.ts"
import { reserveUsage } from "../coaching/queries.ts"
import type { ExampleRow, JobKind, JobStatus } from "../enrichment/index.ts"
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

const ON_DEMAND = 1_000

const REFILL_AFTER = 60 * 60 * 1000
const RETRY_AFTER = 10 * 60 * 1000

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export const enrichmentStatus = (ready: boolean, available: boolean, job: JobStatus | undefined): EnrichmentStatus => {
  if (ready) return "ready"
  if (!available) return "unavailable"
  return Match.value(job).pipe(
    Match.when(undefined, () => "unrequested" as const),
    Match.when(Match.is("queued", "running"), () => "queued" as const),
    Match.when(Match.is("done", "failed"), () => "unavailable" as const),
    Match.exhaustive
  )
}

export const makeEnrichmentStatus = Effect.gen(function* () {
  const db = yield* Database
  const claude = yield* Claude
  const pronouncer = yield* Pronouncer
  const examplesHourly = yield* Config.Int("KOTORI_ENRICH_HOURLY_LIMIT").pipe(Config.withDefault(60))
  const examplesDaily = yield* Config.Int("KOTORI_ENRICH_DAILY_LIMIT").pipe(Config.withDefault(300))

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

  const lookAt = Effect.fnUntraced(function* (entry: Pick<EntryRecord, "id" | "language">) {
    const examples = yield* examplesFor(db, [entry.id])
    const hasExamples = examples.some((example) => example.source === "kotori")
    const jobs = yield* jobStatusFor(db, entry.id)
    const toVoice = sentencesToVoice(examples, { writing: examplesToCome(jobs.get("examples"), examples) })
    const clips = yield* exampleClips(
      db,
      examples.map((example) => example.id)
    )
    // Seeded examples lack formality until Jev judges them; do not wait on them when Jev is unconfigured or already declined casting.
    const voiceable = (example: ExampleRow) =>
      example.formality !== null || (pronouncer.judges && !judgedCasting(example))
    const unvoiced = toVoice.filter((example) => voiceable(example) && !clips.has(`${example.id}:${entry.language}`))
    const hasAudio = (yield* entryClips(db, [entry.id])).size > 0 && unvoiced.length === 0
    const coachAvailable = yield* claude.available
    return { hasExamples, hasAudio, unvoiced, coachAvailable, jobs }
  })

  const statusOf = (
    look: Effect.Success<ReturnType<typeof lookAt>>,
    jobs: ReadonlyMap<JobKind, JobStatus>
  ): Enrichment => ({
    examples: enrichmentStatus(look.hasExamples, look.coachAvailable, jobs.get("examples")),
    audio: enrichmentStatus(look.hasAudio, pronouncer.configured, jobs.get("audio"))
  })

  const enrichmentOf = (entry: Pick<EntryRecord, "id" | "language">) =>
    Effect.map(lookAt(entry), (look) => statusOf(look, look.jobs))

  const requestFor = Effect.fnUntraced(function* (entry: Pick<EntryRecord, "id" | "language">, requester: UserId) {
    const look = yield* lookAt(entry)
    const { hasExamples, hasAudio, unvoiced, coachAvailable, jobs: before } = look
    const now = new Date(yield* Clock.currentTimeMillis)
    const retryWindow = new Date(now.getTime() - RETRY_AFTER)
    const refillWindow = new Date(now.getTime() - REFILL_AFTER)
    const queueOrRetry = (kind: JobKind): Effect.Effect<boolean> => {
      switch (before.get(kind)) {
        case "failed":
          return refillJob(db, kind, entry.id, retryWindow, ON_DEMAND, now)
        case "done":
          return refillJob(db, kind, entry.id, refillWindow, ON_DEMAND, now)
        case undefined:
          return Effect.flatMap(queueNewJob(db, kind, entry.id, ON_DEMAND, now), (queued) =>
            queued ? Effect.succeed(true) : Effect.as(enqueueJob(db, kind, entry.id, ON_DEMAND, now), false)
          )
        case "queued":
        case "running":
          return Effect.as(enqueueJob(db, kind, entry.id, ON_DEMAND, now), false)
      }
    }

    if (!hasExamples && coachAvailable)
      yield* db
        .transaction(() =>
          Effect.gen(function* () {
            if (yield* queueOrRetry("examples")) yield* reserveExamples(requester, now)
          })
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    if (!hasAudio && pronouncer.configured) {
      if (before.get("audio") !== "done") {
        yield* queueOrRetry("audio")
      } else {
        // Refill immediately for examples written after the audio job settled, and at most once per REFILL_AFTER for unjudged seeded examples.
        const untried = Math.max(
          ...unvoiced.map((example) =>
            example.formality === null ? now.getTime() - REFILL_AFTER : example.createdAt.getTime()
          )
        )
        if (unvoiced.length > 0) yield* refillJob(db, "audio", entry.id, new Date(untried), ON_DEMAND, now)
      }
    }

    return statusOf(look, yield* jobStatusFor(db, entry.id))
  })

  return { enrichmentOf, requestFor }
})
