import { index, integer, pgEnum, text, unique } from "drizzle-orm/pg-core"
import { createdAt, table, timestamptz } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

export const jobKind = pgEnum("job_kind", ["examples", "audio"])

export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"])

/** Enrichment work queue, shared by the API (on-demand requests) and the worker. One job per kind and entry. */
export const jobs = table(
  "jobs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    kind: jobKind().notNull(),
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    priority: integer().notNull().default(0),
    status: jobStatus().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    error: text(),
    /** Not before this moment; pushed into the future by retries. */
    runAfter: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamptz().notNull().defaultNow()
  },
  (t) => [
    unique("jobs_kind_entry").on(t.kind, t.entryId),
    index("jobs_pending").on(t.status, t.priority.desc(), t.runAfter)
  ]
)
