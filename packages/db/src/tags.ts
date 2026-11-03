import { text } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"

/** JMDict's tag codes with their human-readable labels, for parts of speech, misc and field codes. */
export const tags = table("tags", {
  code: text().primaryKey(),
  label: text().notNull()
})
