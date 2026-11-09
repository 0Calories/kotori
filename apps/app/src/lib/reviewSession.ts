import type { Rating, ReviewItem } from "@kotori/contracts"
import { shownReviewCard } from "./review.ts"

/**
 * A review session as one state machine. The screen sends events, the reducer returns the next
 * state, and `reviewView` derives what to draw. Per-card facts (revealed, leech) are keyed to a
 * card id, so they cannot outlive the card they describe.
 */

export type ReviewNotice = "answerFailed"

export type ReviewSessionState = {
  /** The card on screen. A refetch can't replace it until it is answered. */
  readonly pinned: ReviewItem | null
  /** Ids of cards whose answer is still on its way to the server. They are skipped locally. */
  readonly inFlight: readonly string[]
  /** Cards answered and saved, or on their way. */
  readonly reviewed: number
  /** The card whose answer is showing. Any other card shows its front. */
  readonly revealedId: string | null
  /** The card the leech warning belongs to. */
  readonly leechId: string | null
  readonly notice: ReviewNotice | null
}

export const initialReviewSession: ReviewSessionState = {
  pinned: null,
  inFlight: [],
  reviewed: 0,
  revealedId: null,
  leechId: null,
  notice: null
}

export type ReviewSessionEvent =
  /** The opening card, or the first one after the queue ran dry. Never replaces a card on screen. */
  | { readonly type: "pin"; readonly item: ReviewItem }
  /** Show the answer of this card. `null` means no card is on screen, so nothing happens. */
  | { readonly type: "reveal"; readonly cardId: string | null }
  /** Rate the card on screen. `items` is the queue as last fetched. */
  | {
      readonly type: "answer"
      readonly item: ReviewItem
      readonly rating: Rating
      readonly items: readonly ReviewItem[]
    }
  /** The server recorded the answer and the queue was fetched again. */
  | { readonly type: "answerSaved"; readonly cardId: string; readonly leech: boolean }
  /** The server did not record the answer: put the card back. */
  | { readonly type: "answerFailed"; readonly item: ReviewItem }
  | { readonly type: "dismissNotice" }

const without = (ids: readonly string[], id: string) => ids.filter((x) => x !== id)

export const reduceReviewSession = (state: ReviewSessionState, event: ReviewSessionEvent): ReviewSessionState => {
  switch (event.type) {
    case "pin":
      return state.pinned === null ? { ...state, pinned: event.item } : state
    case "reveal":
      if (event.cardId === null || event.cardId === state.revealedId) return state
      return { ...state, revealedId: event.cardId }
    case "answer": {
      const id = event.item.card.id
      // Only a revealed card on screen can be answered, and only once.
      if (state.revealedId !== id || state.pinned?.card.id !== id || state.inFlight.includes(id)) return state
      const inFlight = [...state.inFlight, id]
      // Pin the card this answer reveals before the refetch. Gathering again re-spaces new
      // cards and pulls newly due learning cards forward, which would otherwise replace it.
      const next = shownReviewCard(event.items, event.item, new Set(inFlight)) ?? null
      return {
        ...state,
        inFlight,
        pinned: next,
        revealedId: null,
        leechId: null,
        notice: null,
        reviewed: state.reviewed + 1
      }
    }
    case "answerSaved": {
      const inFlight = without(state.inFlight, event.cardId)
      const onScreen = state.pinned?.card.id ?? null
      return { ...state, inFlight, leechId: event.leech ? onScreen : state.leechId }
    }
    case "answerFailed": {
      const id = event.item.card.id
      return {
        ...state,
        inFlight: without(state.inFlight, id),
        reviewed: Math.max(state.reviewed - 1, 0),
        pinned: event.item,
        // The card comes back as a fresh front, not with its answer showing.
        revealedId: null,
        leechId: null,
        notice: "answerFailed"
      }
    }
    case "dismissNotice":
      return state.notice === null ? state : { ...state, notice: null }
  }
}

export type ReviewView = {
  readonly current: ReviewItem | undefined
  readonly revealed: boolean
  readonly leech: boolean
  readonly remaining: number
  readonly total: number
}

/** What the screen shows for `state` given the queue as last fetched. */
export const reviewView = (state: ReviewSessionState, items: readonly ReviewItem[]): ReviewView => {
  const skipped = new Set(state.inFlight)
  const current = shownReviewCard(items, state.pinned, skipped)
  const id = current?.card.id
  const remaining =
    items.filter((item) => !skipped.has(item.card.id) && item.card.id !== id).length + (current === undefined ? 0 : 1)
  return {
    current,
    revealed: id !== undefined && state.revealedId === id,
    leech: id !== undefined && state.leechId === id,
    remaining,
    total: remaining + state.reviewed
  }
}

export type ReviewKeyAction =
  | { readonly type: "close" }
  | { readonly type: "reveal" }
  | { readonly type: "answer"; readonly rating: Rating }

const RATING_KEYS: Readonly<Record<string, Rating>> = { "1": "again", "2": "hard", "3": "good", "4": "easy" }

/**
 * What a key press does. Auto-repeat is ignored, so holding Space can't reveal and then answer.
 * Reveal and answer keys do nothing without a card on screen.
 */
export const reviewKeyAction = (
  event: { readonly key: string; readonly repeat?: boolean },
  view: { readonly hasCard: boolean; readonly revealed: boolean }
): ReviewKeyAction | null => {
  if (event.repeat === true) return null
  if (event.key === "Escape") return { type: "close" }
  if (!view.hasCard) return null
  if (event.key === " " || event.key === "Enter") {
    return view.revealed ? { type: "answer", rating: "good" } : { type: "reveal" }
  }
  const rating = RATING_KEYS[event.key]
  return rating !== undefined && view.revealed ? { type: "answer", rating } : null
}

/** How soon to ask the server again when only learning cards remain. */
export const WAIT_RETRY_MS = 2000
const WAIT_GRACE_MS = 500

/**
 * Delay before the next refetch while waiting for a card to come due. A due time already past
 * (the device clock is ahead of the server) retries after a pause, so it can't spin.
 */
export const waitRefetchDelay = (nextDue: number, now: number): number =>
  nextDue > now ? nextDue - now + WAIT_GRACE_MS : WAIT_RETRY_MS
