import * as schema from "@kotori/db"
import { defineRelations } from "drizzle-orm"

/**
 * How the tables relate, for `db.query.<table>.findMany({ with: … })`. Foreign keys are
 * declared on the tables; this adds the names and directions the relational queries use.
 */
export const relations = defineRelations(schema, (r) => ({
  entries: {
    searchRows: r.many.entrySearch({ from: r.entries.id, to: r.entrySearch.entryId })
  },
  entrySearch: {
    entry: r.one.entries({ from: r.entrySearch.entryId, to: r.entries.id, optional: false })
  },
  audio: {
    file: r.one.audioFiles({ from: r.audio.key, to: r.audioFiles.key })
  },
  users: {
    notes: r.many.notes({ from: r.users.id, to: r.notes.userId })
  },
  notes: {
    user: r.one.users({ from: r.notes.userId, to: r.users.id, optional: false }),
    entry: r.one.entries({ from: r.notes.entryId, to: r.entries.id }),
    reviews: r.many.reviewLogs({ from: r.notes.id, to: r.reviewLogs.noteId })
  },
  reviewLogs: {
    note: r.one.notes({ from: r.reviewLogs.noteId, to: r.notes.id, optional: false })
  }
}))
