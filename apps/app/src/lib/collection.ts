import type { Note, NoteId, QueueCounts, ReviewQueue, StudyStats } from "@kotori/contracts"

/** A review card counts as mature once its interval reaches this many days. Same cut as the study queries. */
const MATURE_DAYS = 21

/** The collection with one saved note taken out. */
export const withoutNote = (notes: ReadonlyArray<Note>, id: NoteId): ReadonlyArray<Note> =>
  notes.filter((note) => note.id !== id)

const dueKey = (queue: Note["cards"][number]["queue"]): keyof QueueCounts =>
  queue === "review" ? "review" : queue === "new" ? "new" : "learning"

/** Count against the full eligible set, not the page of review items. */
const droppedDue = (queue: ReviewQueue, id: NoteId): QueueCounts => {
  let fresh = 0
  let learning = 0
  let review = 0
  // Older servers lack membership metadata; only subtract cards we can establish are due.
  const dueCards = queue.dueCards ?? queue.items.map(({ card }) => card)
  for (const card of dueCards) {
    if (card.noteId !== id) continue
    const key = dueKey(card.queue)
    if (key === "new") fresh += 1
    else if (key === "learning") learning += 1
    else review += 1
  }
  return { new: fresh, learning, review }
}

const subtract = (counts: QueueCounts, dropped: QueueCounts): QueueCounts => ({
  new: Math.max(0, counts.new - dropped.new),
  learning: Math.max(0, counts.learning - dropped.learning),
  review: Math.max(0, counts.review - dropped.review)
})

/**
 * The review queue without that note's cards. Due counts shrink only for cards
 * in the server's complete eligible set: future or daily-limited cards stay out.
 */
export const queueWithoutNote = (queue: ReviewQueue, id: NoteId): ReviewQueue => ({
  ...queue,
  items: queue.items.filter((item) => item.card.noteId !== id),
  dueCards: queue.dueCards?.filter((card) => card.noteId !== id),
  counts: subtract(queue.counts, droppedDue(queue, id))
})

/**
 * Totals that can be read off the note itself: how many notes and cards remain,
 * and how the new / young / mature split moves. Due counts follow the queue,
 * so a card that was not due stays out of them. Reviewed-today, the streak,
 * retention and the forecast depend on review logs and the study-day clock,
 * so they are left for the refetch.
 */
export const statsWithoutNote = (stats: StudyStats, note: Note, queue: ReviewQueue | undefined): StudyStats => {
  let unseen = 0
  let young = 0
  let mature = 0
  for (const card of note.cards) {
    if (card.queue === "new") unseen += 1
    else if (card.queue === "review" && card.interval >= MATURE_DAYS) mature += 1
    else young += 1
  }
  const due = queue === undefined ? stats.due : subtract(stats.due, droppedDue(queue, note.id))
  return {
    ...stats,
    due,
    notes: Math.max(0, stats.notes - 1),
    cards: Math.max(0, stats.cards - note.cards.length),
    unseen: Math.max(0, stats.unseen - unseen),
    young: Math.max(0, stats.young - young),
    mature: Math.max(0, stats.mature - mature)
  }
}
