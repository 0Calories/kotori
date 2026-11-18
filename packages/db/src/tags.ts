import { text } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"

/** JMDict's tag codes with their human-readable names, for parts of speech, misc and field codes. */
export const tags = table("tags", {
  code: text().primaryKey(),
  name: text().notNull()
})
