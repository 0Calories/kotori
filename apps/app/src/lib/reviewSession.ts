import type { Rating, ReviewItem } from "@kotori/contracts"
import { shownReviewNote } from "./review.ts"

/**
 * A review session as one state machine. The screen sends events, the reducer returns the next
 * state, and `reviewView` derives what to draw. Per-note facts (revealed, leech) are keyed to a
 * note id, so they cannot outlive the note they describe.
 */

export type ReviewNotice = "answerFailed"

export type ReviewSessionState = {
  /** The note on screen. A refetch can't replace it until it is answered. */
  readonly pinned: ReviewItem | null
  /** Ids of notes whose answer is still on its way to the server. They are skipped locally. */
  readonly inFlight: readonly string[]
  /** Notes answered and saved, or on their way. */
  readonly reviewed: number
  /** The note whose answer is showing. Any other note shows its front. */
  readonly revealedId: string | null
  /** The note the leech warning belongs to. */
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
  /** The opening note, or the first one after the due notes ran out. Never replaces a note on screen. */
  | { readonly type: "pin"; readonly item: ReviewItem }
  /** Show the answer of this note. `null` means no note is on screen, so nothing happens. */
  | { readonly type: "reveal"; readonly noteId: string | null }
  /** Rate the note on screen. `items` is the due notes as last fetched. */
  | {
      readonly type: "answer"
      readonly item: ReviewItem
      readonly rating: Rating
      readonly items: readonly ReviewItem[]
    }
  /** The server recorded the answer and the due notes were fetched again. */
  | { readonly type: "answerSaved"; readonly noteId: string; readonly leech: boolean }
  /** The server did not record the answer: put the note back. */
  | { readonly type: "answerFailed"; readonly item: ReviewItem }
  | { readonly type: "dismissNotice" }

const without = (ids: readonly string[], id: string) => ids.filter((x) => x !== id)

export const reduceReviewSession = (state: ReviewSessionState, event: ReviewSessionEvent): ReviewSessionState => {
  switch (event.type) {
    case "pin":
      return state.pinned === null ? { ...state, pinned: event.item } : state
    case "reveal":
      if (event.noteId === null || event.noteId === state.revealedId) return state
      return { ...state, revealedId: event.noteId }
    case "answer": {
      const id = event.item.note.id
      // Only a revealed note on screen can be answered, and only once.
      if (state.revealedId !== id || state.pinned?.note.id !== id || state.inFlight.includes(id)) return state
      const inFlight = [...state.inFlight, id]
      // Pin the note this answer reveals before the refetch. Gathering again re-spaces new
      // notes and pulls newly due learning notes forward, which would otherwise replace it.
      const next = shownReviewNote(event.items, event.item, new Set(inFlight)) ?? null
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
      const inFlight = without(state.inFlight, event.noteId)
      const onScreen = state.pinned?.note.id ?? null
      return { ...state, inFlight, leechId: event.leech ? onScreen : state.leechId }
    }
    case "answerFailed": {
      const id = event.item.note.id
      return {
        ...state,
        inFlight: without(state.inFlight, id),
        reviewed: Math.max(state.reviewed - 1, 0),
        pinned: event.item,
        // The note comes back as a fresh front, not with its answer showing.
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

/** What the screen shows for `state` given the due notes as last fetched. */
export const reviewView = (state: ReviewSessionState, items: readonly ReviewItem[]): ReviewView => {
  const skipped = new Set(state.inFlight)
  const current = shownReviewNote(items, state.pinned, skipped)
  const id = current?.note.id
  const remaining =
    items.filter((item) => !skipped.has(item.note.id) && item.note.id !== id).length + (current === undefined ? 0 : 1)
  return {
    current,
    revealed: id !== undefined && state.revealedId === id,
    leech: id !== undefined && state.leechId === id,
    remaining,
    total: remaining + state.reviewed
  }
}

/**
 * The due notes as last fetched, less the ones answered since. A refetch that fails keeps the
 * old list, which still holds notes answered after it was fetched; without this they would come
 * round again. `savedAt` is when the server recorded each answer, `fetchedAt` when the list arrived.
 */
export const unansweredItems = (
  items: readonly ReviewItem[],
  savedAt: ReadonlyMap<string, number>,
  fetchedAt: number
): readonly ReviewItem[] => items.filter((item) => (savedAt.get(item.note.id) ?? -Infinity) < fetchedAt)

export type ReviewKeyAction =
  | { readonly type: "close" }
  | { readonly type: "reveal" }
  | { readonly type: "answer"; readonly rating: Rating }

const RATING_KEYS: Readonly<Record<string, Rating>> = { "1": "again", "2": "hard", "3": "good", "4": "easy" }

/**
 * What a key press does. Auto-repeat is ignored, so holding Space can't reveal and then answer.
 * Reveal and answer keys do nothing without a note on screen.
 */
export const reviewKeyAction = (
  event: { readonly key: string; readonly repeat?: boolean },
  view: { readonly hasNote: boolean; readonly revealed: boolean }
): ReviewKeyAction | null => {
  if (event.repeat === true) return null
  if (event.key === "Escape") return { type: "close" }
  if (!view.hasNote) return null
  if (event.key === " " || event.key === "Enter") {
    return view.revealed ? { type: "answer", rating: "good" } : { type: "reveal" }
  }
  const rating = RATING_KEYS[event.key]
  return rating !== undefined && view.revealed ? { type: "answer", rating } : null
}

/** How soon to ask the server again when only learning notes remain. */
export const WAIT_RETRY_MS = 2000
const WAIT_GRACE_MS = 500

/**
 * Delay before the next refetch while waiting for a note to come due. A due time already past
 * (the device clock is ahead of the server) retries after a pause, so it can't spin.
 */
export const waitRefetchDelay = (nextDue: number, now: number): number =>
  nextDue > now ? nextDue - now + WAIT_GRACE_MS : WAIT_RETRY_MS
