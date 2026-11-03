import { bytea, text } from "drizzle-orm/pg-core"
import { audio } from "./audio.ts"
import { table } from "./columns.ts"

/** The clip bytes, in the database so the API and the worker share them without a disk. */
export const audioFiles = table("audio_files", {
  key: text()
    .primaryKey()
    .references(() => audio.key, { onDelete: "cascade" }),
  data: bytea().notNull()
})
