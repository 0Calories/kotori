import type { Enrichment } from "@kotori/contracts"
import { ApiError, apiErrorMessage, retryMinutes } from "../api/errors.ts"
import type { Strings } from "../i18n/strings.ts"

/**
 * How an open entry waits for its enrichment. The entry screen asks for the work once
 * (`shouldAsk`), then polls the small progress read rather than the whole entry (`pollInterval`),
 * and fetches the entry again only when progress moved past what it shows (`shouldRefresh`).
 * Asking is charged to the learner, so a refusal or failure stops the waiting (`enrichmentPhase`).
 */

/** How often progress is checked while something is on its way. */
export const POLL_MS = 3000

/** Whether any of the entry's examples or audio is still on its way. */
export const isComing = (enrichment: Enrichment | undefined): boolean =>
  enrichment !== undefined && (enrichment.examples === "queued" || enrichment.audio === "queued")

/**
 * Whether to ask for the entry's enrichment now: the entry on screen is not being fetched (so a
 * stale copy from an earlier visit doesn't decide), something on it is on its way, and this
 * opening hasn't asked for this entry yet. `askedFor` is the entry this opening last asked for.
 */
export const shouldAsk = (input: {
  readonly id: number
  readonly onScreen: Enrichment | undefined
  readonly settled: boolean
  readonly askedFor: number | null
}): boolean => input.settled && input.askedFor !== input.id && isComing(input.onScreen)

/** React Query's `refetchInterval` for progress: poll while something is on its way, then stop. */
export const pollInterval = (latest: Enrichment | undefined): number | false => (isComing(latest) ? POLL_MS : false)

/** One progress reading as a string, to compare readings and remember which one the entry was fetched for. */
export const progressKey = (enrichment: Enrichment): string => `${enrichment.examples}/${enrichment.audio}`

/**
 * Whether progress has moved past the entry on screen (something became ready, or stopped
 * coming), so the entry is fetched again to show it. Each reading fetches the entry at most once:
 * `refreshedFor` is the reading it was last fetched for.
 */
export const shouldRefresh = (
  onScreen: Enrichment,
  progress: Enrichment | undefined,
  refreshedFor: string | null
): boolean =>
  progress !== undefined && progressKey(progress) !== progressKey(onScreen) && progressKey(progress) !== refreshedFor

/** Where asking for an entry's enrichment stands, as React Query reports a mutation. */
export interface Ask {
  readonly status: "idle" | "pending" | "success" | "error"
  readonly error: unknown
}

/**
 * Where an open entry's enrichment stands:
 * - `settled`: nothing is on its way, so nothing is asked for or polled.
 * - `asking`: something is on its way and the ask is about to go, or is in flight.
 * - `waiting`: the ask went through and progress is polled until nothing is on its way.
 * - `limited`: the learner has asked for a lot lately; the entry stays as it is, without polling.
 * - `failed`: the ask failed otherwise; the entry stays as it is, with a way to try again.
 */
export type EnrichmentPhase = "settled" | "asking" | "waiting" | "limited" | "failed"

export const enrichmentPhase = (onScreen: Enrichment, progress: Enrichment | undefined, ask: Ask): EnrichmentPhase => {
  switch (ask.status) {
    case "error":
      return ask.error instanceof ApiError && ask.error.tag === "RateLimited" ? "limited" : "failed"
    case "pending":
      return "asking"
    case "success":
      // Until the entry is fetched again, what it shows as coming is still coming.
      return isComing(onScreen) || isComing(progress) ? "waiting" : "settled"
    case "idle":
      return isComing(onScreen) ? "asking" : "settled"
  }
}

/** Whether the page says Kotori is writing example sentences: they are on their way, as far as it knows. */
export const writingExamples = (
  phase: EnrichmentPhase,
  onScreen: Enrichment,
  progress: Enrichment | undefined
): boolean =>
  (phase === "asking" || phase === "waiting") && (onScreen.examples === "queued" || progress?.examples === "queued")

/**
 * What the page says when asking didn't go through: Kotori will write more later after a
 * refusal, what went wrong otherwise. Nothing while asking is fine.
 */
export const enrichmentNotice = (t: Strings, phase: EnrichmentPhase, error: unknown): string | null => {
  switch (phase) {
    case "limited":
      return t.entry.examplesLater(error instanceof ApiError ? retryMinutes(error) : 1)
    case "failed":
      return apiErrorMessage(t, error)
    default:
      return null
  }
}
