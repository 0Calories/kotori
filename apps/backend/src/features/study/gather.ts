/**
 * The order a review session walks: learning notes that are due (they're
 * time-sensitive), then reviews with new notes spread among them, then learning
 * notes not quite due yet, as with Anki's learn-ahead limit.
 *
 * Gathering again can change the head. Answering a review re-spaces the new
 * notes, and a learning note whose due time has passed jumps in front of
 * whatever was showing. Callers that already have a note on screen must not
 * follow that new head.
 */
export const gatherDueNotes = <Note extends { readonly due: Date }>(
  learning: ReadonlyArray<Note>,
  reviews: ReadonlyArray<Note>,
  fresh: ReadonlyArray<Note>,
  now: Date
): Note[] => {
  const ordered: Note[] = learning.filter((note) => note.due <= now)
  // At least one review between new notes, and no division by zero when nothing is new.
  const spacing = fresh.length === 0 ? Infinity : Math.max(Math.floor(reviews.length / fresh.length), 1)
  let next = 0
  reviews.forEach((note, index) => {
    ordered.push(note)
    if ((index + 1) % spacing === 0 && next < fresh.length) ordered.push(fresh[next++]!)
  })
  ordered.push(...fresh.slice(next))
  ordered.push(...learning.filter((note) => note.due > now))
  return ordered
}
