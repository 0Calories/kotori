import { jsonb, text } from "drizzle-orm/pg-core"
import { createdAt, table } from "./columns.ts"

export const coachCache = table("coach_cache", {
  key: text().primaryKey(),
  result: jsonb().notNull(),
  createdAt: createdAt()
})
