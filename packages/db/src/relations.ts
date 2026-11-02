import { defineRelations } from "drizzle-orm"
import * as schema from "./tables.ts"

/**
 * How the tables relate, for `db.query.<table>.findMany({ with: … })`. Foreign keys are
 * declared on the tables; this adds the names and directions the relational queries use.
 * Every relation names its columns explicitly, which Drizzle requires unless the reverse
 * side is declared too.
 */
export const relations = defineRelations(schema, (r) => ({
  entries: {
    forms: r.many.forms({ from: r.entries.id, to: r.forms.entryId }),
    senses: r.many.senses({ from: r.entries.id, to: r.senses.entryId }),
    glosses: r.many.glosses({ from: r.entries.id, to: r.glosses.entryId }),
    audio: r.one.entryAudio({ from: r.entries.id, to: r.entryAudio.entryId }),
    jobs: r.many.jobs({ from: r.entries.id, to: r.jobs.entryId })
  },
  forms: {
    entry: r.one.entries({ from: r.forms.entryId, to: r.entries.id, optional: false })
  },
  senses: {
    entry: r.one.entries({ from: r.senses.entryId, to: r.entries.id, optional: false }),
    glosses: r.many.glosses({ from: [r.senses.entryId, r.senses.position], to: [r.glosses.entryId, r.glosses.sense] }),
    nuance: r.one.senseNuance({
      from: [r.senses.entryId, r.senses.position],
      to: [r.senseNuance.entryId, r.senseNuance.sense]
    }),
    similar: r.many.similarWords({
      from: [r.senses.entryId, r.senses.position],
      to: [r.similarWords.entryId, r.similarWords.sense]
    }),
    examples: r.many.examples({
      from: [r.senses.entryId, r.senses.position],
      to: [r.examples.entryId, r.examples.sense]
    })
  },
  similarWords: {
    similar: r.one.entries({ from: r.similarWords.similarId, to: r.entries.id, optional: false })
  },
  examples: {
    audio: r.many.exampleAudio({ from: r.examples.id, to: r.exampleAudio.exampleId })
  },
  entryAudio: {
    clip: r.one.audio({ from: r.entryAudio.audioKey, to: r.audio.key, optional: false })
  },
  exampleAudio: {
    clip: r.one.audio({ from: r.exampleAudio.audioKey, to: r.audio.key, optional: false })
  },
  audio: {
    file: r.one.audioFiles({ from: r.audio.key, to: r.audioFiles.key })
  },
  users: {
    notes: r.many.notes({ from: r.users.id, to: r.notes.userId }),
    cards: r.many.cards({ from: r.users.id, to: r.cards.userId })
  },
  notes: {
    user: r.one.users({ from: r.notes.userId, to: r.users.id, optional: false }),
    entry: r.one.entries({ from: r.notes.entryId, to: r.entries.id }),
    cards: r.many.cards({ from: r.notes.id, to: r.cards.noteId })
  },
  cards: {
    note: r.one.notes({ from: r.cards.noteId, to: r.notes.id, optional: false }),
    reviews: r.many.reviewLogs({ from: r.cards.id, to: r.reviewLogs.cardId })
  },
  reviewLogs: {
    card: r.one.cards({ from: r.reviewLogs.cardId, to: r.cards.id, optional: false })
  }
}))
