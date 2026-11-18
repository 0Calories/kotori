import { text } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"

export const tags = table("tags", {
  code: text().primaryKey(),
  name: text().notNull()
})
