import type { ReviewItem } from "@kotori/contracts"

/**
 * The card a review session shows.
 *
 * The queue is gathered again on every fetch. A learning card that comes due
 * jumps to the front, and new cards are spread through whatever reviews remain,
 * so the head of a later payload is often a different card. The one already on
 * screen (`pinned`) stays until it has been answered; a payload that no longer
 * contains it is kept too, so the session doesn't swap in a replacement.
 */
export const shownReviewCard = (
  items: readonly ReviewItem[],
  pinned: ReviewItem | null,
  answered: ReadonlySet<string>
): ReviewItem | undefined => {
  if (pinned !== null && !answered.has(pinned.card.id)) {
    return items.find((item) => item.card.id === pinned.card.id) ?? pinned
  }
  return items.find((item) => !answered.has(item.card.id))
}
