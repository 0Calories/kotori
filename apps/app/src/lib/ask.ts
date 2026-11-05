import type {
  AskRefusal,
  DraftEntry,
  EntrySummary,
  Language,
  Proposal,
  ProposalRoute,
  SearchMatch
} from "@kotori/contracts"
import type { Facing, Mood } from "../mascot/geometry.ts"

/**
 * Ask Kotori as the app shows it: offered, thinking, answered or failed. Everything here is
 * plain data and timing, so the choices the panel makes can be tested without rendering it.
 */

/**
 * The least time Kotori spends thinking once asked. An answer someone else already paid for
 * comes back at once, and would otherwise flash the thinking pose for a frame.
 */
export const ASK_MIN_THINKING_MS = 900

/** When each line of the thinking status takes over, in ms since the ask was sent. */
export const ASK_STAGE_STARTS = [0, 3000, 7500, 14_000] as const

/** Which status line shows `elapsed` ms into an ask. */
export const askStage = (elapsed: number) => {
  let stage = 0
  ASK_STAGE_STARTS.forEach((start, index) => {
    if (elapsed >= start) stage = index
  })
  return stage
}

/**
 * How full the progress bar is `elapsed` ms into an ask. Claude's answer takes anywhere from a
 * few seconds to half a minute, and nothing says how far along it is, so the bar shows a sliver
 * at once and eases toward the end without reaching it: about half full at 7 s, 90% at 30 s.
 */
export const askProgress = (elapsed: number) => {
  "worklet"
  return 0.06 + 0.88 * (1 - Math.exp(-Math.max(elapsed, 0) / 9000))
}

/** "0:27", "9:42": how long until Kotori can be asked again, rounded up to the second. */
export const formatWait = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** What the answer on record comes to on screen. */
export type AskAnswer =
  /** Claude drafted an entry; it's unverified until a person checks it. */
  | { readonly kind: "draft"; readonly draft: DraftEntry }
  /** The query names an entry the dictionary has: one it had all along, or a draft since approved. */
  | { readonly kind: "linked"; readonly entry: EntrySummary; readonly approved: boolean }
  /** Not a real expression (Claude's reason, if it gave one), or not a lookup at all (`route`). */
  | {
      readonly kind: "rejected"
      readonly reason: string | null
      readonly route: Exclude<ProposalRoute, "lookup"> | null
    }
  /** A draft the admin turned down, with their reason if they gave one. */
  | { readonly kind: "discarded"; readonly reason: string | null }

/**
 * How to show a proposal, or null when there is nothing left to show: a link or approval whose
 * entry has since been deleted.
 */
export const askAnswer = (proposal: Proposal): AskAnswer | null => {
  switch (proposal.status) {
    case "pending":
      return proposal.draft === null ? null : { kind: "draft", draft: proposal.draft }
    case "linked":
    case "approved":
      return proposal.linked === null
        ? null
        : { kind: "linked", entry: proposal.linked, approved: proposal.status === "approved" }
    case "rejected":
      return {
        kind: "rejected",
        reason: proposal.reason,
        route: proposal.route === null || proposal.route === "lookup" ? null : proposal.route
      }
    case "discarded":
      return { kind: "discarded", reason: proposal.reason }
  }
}

/** The parts of an `ApiError` that decide how a failed ask reads. */
export interface AskError {
  readonly tag: string
  readonly refusal: AskRefusal | null
  readonly retry: { readonly afterSeconds: number; readonly at: number } | null
}

/** Why an ask failed, as the panel words it. */
export type AskFailure =
  /** Turned away before anyone was asked: asking again won't change that. */
  | { readonly kind: "refused"; readonly refusal: AskRefusal }
  /** Claude is busy (seconds) or this hour's asks are used up (minutes): try again at `retryAt`. */
  | { readonly kind: "busy" | "resting"; readonly retryAt: number }
  /** Today's asks are used up. */
  | { readonly kind: "napping" }
  | { readonly kind: "unavailable" | "offline" | "unexpected" }

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS

/**
 * Sorts a failed ask by what the learner can do about it. A rate limit says how long to wait,
 * and the server's waits mean: 30 s while Claude is busy, 10 minutes for the hourly allowance,
 * an hour or more for the daily one.
 */
export const askFailure = (error: AskError | null): AskFailure => {
  if (error === null) return { kind: "unexpected" }
  switch (error.tag) {
    case "AskRefused":
      return error.refusal === null ? { kind: "unexpected" } : { kind: "refused", refusal: error.refusal }
    case "RateLimited": {
      if (error.retry === null) return { kind: "busy", retryAt: 0 }
      const { afterSeconds, at } = error.retry
      if (afterSeconds >= HOUR_SECONDS) return { kind: "napping" }
      return { kind: afterSeconds > MINUTE_SECONDS ? "resting" : "busy", retryAt: at }
    }
    case "AiUnavailable":
      return { kind: "unavailable" }
    case "Offline":
      return { kind: "offline" }
    default:
      return { kind: "unexpected" }
  }
}

/** Whether asking again could go differently. */
export const retryable = (failure: AskFailure) => failure.kind !== "refused" && failure.kind !== "napping"

/** The latest ask of this query, as the mutation cache holds it. */
export interface AskAttempt {
  readonly status: "idle" | "pending" | "success" | "error"
  readonly error: unknown
  readonly data: Proposal | undefined
  readonly submittedAt: number
}

export type AskView =
  /** Nothing to say beyond the search's own message: the query can't be asked about. */
  | { readonly phase: "quiet" }
  | { readonly phase: "offer" }
  | { readonly phase: "thinking"; readonly since: number }
  /** `live`: this panel watched Kotori work it out, so the answer arrives with a flourish. */
  | { readonly phase: "answered"; readonly answer: AskAnswer; readonly live: boolean }
  | { readonly phase: "failed"; readonly failure: AskFailure; readonly live: boolean }

/**
 * What the panel shows. An ask in flight thinks, and keeps thinking until
 * `ASK_MIN_THINKING_MS` have passed if this panel saw it start. An answer on record wins over a
 * failure (a dropped connection may have been answered all the same), and with neither, Kotori
 * offers to look into the query when it can.
 */
export const askView = ({
  attempt,
  proposal,
  offerable,
  watched,
  now,
  toError
}: {
  readonly attempt: AskAttempt | undefined
  /** The learner's answer on record for this query, if any. */
  readonly proposal: Proposal | null
  readonly offerable: boolean
  /** Whether this panel has seen the latest attempt in flight. */
  readonly watched: boolean
  readonly now: number
  readonly toError: (error: unknown) => AskError | null
}): AskView => {
  if (attempt?.status === "pending") return { phase: "thinking", since: attempt.submittedAt }
  const settled = attempt !== undefined && attempt.status !== "idle"
  if (settled && watched && now < attempt.submittedAt + ASK_MIN_THINKING_MS) {
    return { phase: "thinking", since: attempt.submittedAt }
  }
  const record = proposal ?? attempt?.data ?? null
  const answer = record === null ? null : askAnswer(record)
  if (answer !== null) return { phase: "answered", answer, live: watched && attempt?.status === "success" }
  if (attempt?.status === "error")
    return { phase: "failed", failure: askFailure(toError(attempt.error)), live: watched }
  // A proposal with nothing left to show still answers the query: asking again would only bring it back.
  if (record !== null) return { phase: "quiet" }
  return offerable ? { phase: "offer" } : { phase: "quiet" }
}

/** When the panel should look again: the moment a held thinking pose may give way to the outcome. */
export const askRevealAt = (attempt: AskAttempt | undefined, watched: boolean) =>
  attempt !== undefined && watched && (attempt.status === "success" || attempt.status === "error")
    ? attempt.submittedAt + ASK_MIN_THINKING_MS
    : null

const front = (mood: Mood) => ({ mood, facing: "front" as const })

const answerMood = (answer: AskAnswer, live: boolean): { readonly mood: Mood; readonly facing: Facing } => {
  switch (answer.kind) {
    case "draft":
      return live ? { mood: "celebrate", facing: "left" } : front("happy")
    case "linked":
      return front("happy")
    case "rejected":
    case "discarded":
      return front("oops")
  }
}

/**
 * Kotori's pose for each moment: unsure over a search that came back empty, curious over
 * lookalikes, thinking while asked, overjoyed at a fresh draft (side on, so its confetti flies)
 * and glad on seeing one again, flustered at a refusal or failure, and asleep once the
 * learner's allowance is spent.
 */
export const askMood = (view: AskView, match: SearchMatch): { readonly mood: Mood; readonly facing: Facing } => {
  switch (view.phase) {
    case "quiet":
    case "offer":
      return front(match === "weak" ? "neutral" : "oops")
    case "thinking":
      return front("thinking")
    case "answered":
      return answerMood(view.answer, view.live)
    case "failed":
      return front(view.failure.kind === "resting" || view.failure.kind === "napping" ? "sleepy" : "oops")
  }
}

/**
 * A draft's headword as large as fits the answer card: 36pt for English up to ten letters and
 * 42pt for Japanese up to five characters, shrinking for longer ones.
 */
export const draftHeadwordSize = (headword: string, language: Language) => {
  const length = Array.from(headword).length
  if (language === "en") return length <= 10 ? 36 : Math.max(22, Math.floor(400 / length))
  return length <= 5 ? 42 : Math.max(24, Math.floor(220 / length))
}
