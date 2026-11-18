import type { DueCounts, DueNotes, Note, NoteId, StudyStats } from "@kotori/contracts"

/** A note in review counts as mature once its interval reaches this many days. Same cut as the study queries. */
const MATURE_DAYS = 21

/** The deck with one saved note taken out. */
export const withoutNote = (notes: ReadonlyArray<Note>, id: NoteId): ReadonlyArray<Note> =>
  notes.filter((note) => note.id !== id)

const dueKey = (retentionStage: Note["retentionStage"]): keyof DueCounts =>
  retentionStage === "review" ? "review" : retentionStage === "new" ? "new" : "learning"

/** Count against the full eligible set, not the page of review items. */
const droppedDue = (due: DueNotes, id: NoteId): DueCounts => {
  const dropped = { new: 0, learning: 0, review: 0 }
  for (const note of due.all) if (note.id === id) dropped[dueKey(note.retentionStage)] += 1
  return dropped
}

const subtract = (counts: DueCounts, dropped: DueCounts): DueCounts => ({
  new: Math.max(0, counts.new - dropped.new),
  learning: Math.max(0, counts.learning - dropped.learning),
  review: Math.max(0, counts.review - dropped.review)
})

/**
 * The due notes without that note. Due counts shrink only if it was in the
 * server's complete eligible set: a future or daily-limited note stays out.
 */
export const dueWithoutNote = (due: DueNotes, id: NoteId): DueNotes => ({
  ...due,
  items: due.items.filter((item) => item.note.id !== id),
  all: due.all.filter((note) => note.id !== id),
  counts: subtract(due.counts, droppedDue(due, id))
})

/**
 * Totals that can be read off the note itself: how many notes remain, and how
 * the new / young / mature split moves. Due counts follow the due notes, so a
 * note that was not due stays out of them. Reviewed-today, the streak,
 * retention and the forecast depend on review logs and the study-day clock,
 * so they are left for the refetch.
 */
export const statsWithoutNote = (stats: StudyStats, note: Note, due: DueNotes | undefined): StudyStats => {
  const unseen = note.retentionStage === "new" ? 1 : 0
  const mature = note.retentionStage === "review" && note.interval >= MATURE_DAYS ? 1 : 0
  const young = 1 - unseen - mature
  return {
    ...stats,
    due: due === undefined ? stats.due : subtract(stats.due, droppedDue(due, note.id)),
    notes: Math.max(0, stats.notes - 1),
    unseen: Math.max(0, stats.unseen - unseen),
    young: Math.max(0, stats.young - young),
    mature: Math.max(0, stats.mature - mature)
  }
}
