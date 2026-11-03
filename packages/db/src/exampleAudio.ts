import { doublePrecision, integer, pgEnum, primaryKey, text } from "drizzle-orm/pg-core"
import { audio } from "./audio.ts"
import { language, table } from "./columns.ts"
import { examples } from "./examples.ts"

/** How a clip's voice was chosen; see docs/voice-casting.md. */
export const castBy = pgEnum("cast_by", ["rules", "jev", "manual"])

/** An example sentence spoken, in Japanese and optionally in English. */
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
    /** How the voice was chosen, and its casting score, for debugging and `kotori audio regen --dry-run`. */
    castBy: castBy(),
    score: doublePrecision()
  },
  (t) => [primaryKey({ columns: [t.exampleId, t.language] })]
)
