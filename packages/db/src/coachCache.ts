import { jsonb, text } from "drizzle-orm/pg-core"
import { createdAt, table } from "./columns.ts"

/** Coach answers cached by request hash, so the same question isn't paid for twice. */
export const coachCache = table("coach_cache", {
  key: text().primaryKey(),
  result: jsonb().notNull(),
  createdAt: createdAt()
})
