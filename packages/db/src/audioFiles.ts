import { bytea, text } from "drizzle-orm/pg-core"
import { audio } from "./audio.ts"
import { table } from "./columns.ts"

/**
 * The clip bytes, in the database so the API and the worker share them without a disk, where
 * no bucket is configured (`KOTORI_AUDIO_BUCKET`): local development and tests. With one, new
 * clips go to the bucket, and `kotori storage audio` moves these there and empties the table.
 */
export const audioFiles = table("audio_files", {
  key: text()
    .primaryKey()
    .references(() => audio.key, { onDelete: "cascade" }),
  data: bytea().notNull()
})
