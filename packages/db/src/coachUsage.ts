import { index, integer, pgEnum, uuid } from "drizzle-orm/pg-core"
import { createdAt, table } from "./columns.ts"
import { type UserId, users } from "./users.ts"

/**
 * `ask` is a Claude draft; `triage` is Jev routing an ask, limited apart as it costs a fraction;
 * `enrich` is a look that queued new enrichment for an entry (nuance, examples, audio).
 */
export const coachKind = pgEnum("coach_kind", ["naturalness", "how-to-say", "speak", "ask", "triage", "enrich"])

/** One row per coach, Ask Kotori or enrichment request, for the per-learner rate limits. */
export const coachUsage = table(
  "coach_usage",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: coachKind().notNull(),
    createdAt: createdAt()
  },
  (t) => [index("coach_usage_user").on(t.userId, t.createdAt)]
)
