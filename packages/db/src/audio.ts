import { integer, text } from "drizzle-orm/pg-core"
import { createdAt, language, table } from "./columns.ts"

export const audio = table("audio", {
  /** `sha256(voiceId, modelId, text)`. */
  key: text().primaryKey(),
  text: text().notNull(),
  language: language().notNull(),
  voiceId: text().notNull(),
  voice: text(),
  modelId: text().notNull(),
  characters: integer().notNull(),
  bytes: integer().notNull(),
  createdAt: createdAt()
})
