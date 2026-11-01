/**
 * The order a review session walks: learning cards that are due (they're
 * time-sensitive), then reviews with new cards spread among them, then learning
 * cards not quite due yet, as with Anki's learn-ahead limit.
 *
 * Gathering again can change the head. Answering a review re-spaces the new
 * cards, and a learning card whose due time has passed jumps in front of
 * whatever was showing. Callers that already have a card on screen must not
 * follow that new head.
 */
export const gatherQueue = <Card extends { readonly due: number }>(
  learning: ReadonlyArray<Card>,
  reviews: ReadonlyArray<Card>,
  fresh: ReadonlyArray<Card>,
  now: number
): Card[] => {
  const ordered: Card[] = learning.filter((card) => card.due <= now)
  // At least one review between new cards, and no division by zero when nothing is new.
  const spacing = fresh.length === 0 ? Infinity : Math.max(Math.floor(reviews.length / fresh.length), 1)
  let next = 0
  reviews.forEach((card, index) => {
    ordered.push(card)
    if ((index + 1) % spacing === 0 && next < fresh.length) ordered.push(fresh[next++]!)
  })
  ordered.push(...fresh.slice(next))
  ordered.push(...learning.filter((card) => card.due > now))
  return ordered
}
