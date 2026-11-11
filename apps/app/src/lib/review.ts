import type { ReviewItem } from "@kotori/contracts"

/**
 * The note a review session shows.
 *
 * The due notes are gathered again on every fetch. A learning note that comes due
 * jumps to the front, and new notes are spread through whatever reviews remain,
 * so the head of a later payload is often a different note. The one already on
 * screen (`pinned`) stays until it has been answered; a payload that no longer
 * contains it is kept too, so the session doesn't swap in a replacement.
 */
export const shownReviewNote = (
  items: readonly ReviewItem[],
  pinned: ReviewItem | null,
  answered: ReadonlySet<string>
): ReviewItem | undefined => {
  if (pinned !== null && !answered.has(pinned.note.id)) {
    return items.find((item) => item.note.id === pinned.note.id) ?? pinned
  }
  return items.find((item) => !answered.has(item.note.id))
}
