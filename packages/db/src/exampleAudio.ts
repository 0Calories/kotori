import { doublePrecision, integer, pgEnum, primaryKey, text } from "drizzle-orm/pg-core"
import { audio } from "./audio.ts"
import { language, table } from "./columns.ts"
import { examples } from "./examples.ts"

export const castBy = pgEnum("cast_by", ["rules", "jev", "manual"])

export const exampleAudio = table(
  "example_audio",
  {
    exampleId: integer()
      .notNull()
      .references(() => examples.id, { onDelete: "cascade" }),
    language: language().notNull(),
    audioKey: text()
      .notNull()
      .references(() => audio.key),
    castBy: castBy(),
    score: doublePrecision()
  },
  (t) => [primaryKey({ columns: [t.exampleId, t.language] })]
)
