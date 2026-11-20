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

// Prevents a 1-frame flash of the thinking pose when a cached answer returns immediately.
export const ASK_MIN_THINKING_MS = 900

export const ASK_STAGE_STARTS = [0, 3000, 7500, 14_000] as const

export const ASK_PONDER_STAGE = 2

export const askStage = (elapsed: number) => {
  let stage = 0
  ASK_STAGE_STARTS.forEach((start, index) => {
    if (elapsed >= start) stage = index
  })
  return stage
}

export const askProgress = (elapsed: number) => {
  "worklet"
  return 0.06 + 0.88 * (1 - Math.exp(-Math.max(elapsed, 0) / 9000))
}

export const formatWait = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export type AskAnswer =
  | { readonly kind: "draft"; readonly draft: DraftEntry }
  | { readonly kind: "linked"; readonly entry: EntrySummary; readonly approved: boolean }
  | {
      readonly kind: "rejected"
      readonly reason: string | null
      readonly route: Exclude<ProposalRoute, "lookup"> | null
    }
  | { readonly kind: "discarded"; readonly reason: string | null }

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
    case "removed":
      return null
  }
}

export interface AskError {
  readonly tag: string
  readonly refusal: AskRefusal | null
  readonly retry: { readonly afterSeconds: number; readonly at: number } | null
}

export type AskFailure =
  | { readonly kind: "refused"; readonly refusal: AskRefusal }
  | { readonly kind: "busy" | "resting"; readonly retryAt: number }
  | { readonly kind: "napping" }
  | { readonly kind: "unavailable" | "offline" | "unexpected" }

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 60 * MINUTE_SECONDS

// The server encodes three rate-limit tiers in retryAfterSeconds: <=1m upstream busy, <1h hourly quota, >=1h daily quota.
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

export const retryable = (failure: AskFailure) => failure.kind !== "refused" && failure.kind !== "napping"

export interface AskAttempt {
  readonly status: "idle" | "pending" | "success" | "error"
  readonly error: unknown
  readonly data: Proposal | undefined
  readonly submittedAt: number
}

export type AskView =
  | { readonly phase: "quiet" }
  | { readonly phase: "offer" }
  | { readonly phase: "thinking"; readonly since: number }
  | { readonly phase: "answered"; readonly answer: AskAnswer; readonly live: boolean }
  | { readonly phase: "failed"; readonly failure: AskFailure; readonly live: boolean }

export const askView = ({
  attempt,
  proposal,
  offerable,
  watched,
  now,
  toError
}: {
  readonly attempt: AskAttempt | undefined
  readonly proposal: Proposal | null
  readonly offerable: boolean
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

export const askMood = (
  view: AskView,
  match: SearchMatch,
  stage = 0
): { readonly mood: Mood; readonly facing: Facing } => {
  switch (view.phase) {
    case "quiet":
    case "offer":
      return front(match === "weak" ? "neutral" : "oops")
    case "thinking":
      return front(stage >= ASK_PONDER_STAGE ? "thinking" : "reading")
    case "answered":
      return answerMood(view.answer, view.live)
    case "failed":
      return front(view.failure.kind === "resting" || view.failure.kind === "napping" ? "sleepy" : "oops")
  }
}

export const draftHeadwordSize = (headword: string, language: Language) => {
  const length = Array.from(headword).length
  if (language === "en") return length <= 10 ? 36 : Math.max(22, Math.floor(400 / length))
  return length <= 5 ? 42 : Math.max(24, Math.floor(220 / length))
}
