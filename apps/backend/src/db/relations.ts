import * as schema from "@kotori/db"
import { defineRelations } from "drizzle-orm"

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
    frequency: r.one.entryFrequency({ from: r.entries.id, to: r.entryFrequency.entryId }),
    cautions: r.many.cautions({ from: r.entries.id, to: r.cautions.entryId }),
    loansFrom: r.many.loanLinks({ from: r.entries.id, to: r.loanLinks.katakanaEntryId }),
    loansTo: r.many.loanLinks({ from: r.entries.id, to: r.loanLinks.englishEntryId }),
    jobs: r.many.jobs({ from: r.entries.id, to: r.jobs.entryId })
  },
  forms: {
    entry: r.one.entries({ from: r.forms.entryId, to: r.entries.id, optional: false })
  },
  senses: {
    entry: r.one.entries({ from: r.senses.entryId, to: r.entries.id, optional: false }),
    glosses: r.many.glosses({ from: [r.senses.entryId, r.senses.position], to: [r.glosses.entryId, r.glosses.sense] }),
    examples: r.many.examples({
      from: [r.senses.entryId, r.senses.position],
      to: [r.examples.entryId, r.examples.sense]
    }),
    labels: r.many.labels({
      from: [r.senses.entryId, r.senses.position],
      to: [r.labels.entryId, r.labels.sense]
    }),
    usagePatterns: r.many.usagePatterns({
      from: [r.senses.entryId, r.senses.position],
      to: [r.usagePatterns.entryId, r.usagePatterns.sense]
    })
  },
  usagePatterns: {
    about: r.one.entries({ from: r.usagePatterns.aboutEntryId, to: r.entries.id })
  },
  cautions: {
    about: r.one.entries({ from: r.cautions.aboutEntryId, to: r.entries.id })
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
