import { integer, text } from "drizzle-orm/pg-core"
import { createdAt, language, table } from "./columns.ts"

/**
 * Content-addressed speech clips: `key` is sha256(voice, model, text), so the same
 * phrase is never synthesised twice. Metadata here, bytes in a bucket or `audio_files`.
 */
export const audio = table("audio", {
  key: text().primaryKey(),
  text: text().notNull(),
  language: language().notNull(),
  /** The provider's voice id, part of the key. */
  voiceId: text().notNull(),
  /** The Kotori cast voice ("ja-kyoko"); null for clips made before casting or with an uncast provider voice. */
  voice: text(),
  modelId: text().notNull(),
  /** Characters billed by the provider, for the monthly budget. */
  characters: integer().notNull(),
  bytes: integer().notNull(),
  createdAt: createdAt()
})
