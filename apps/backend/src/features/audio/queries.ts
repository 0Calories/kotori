import { audio, entryAudio, type EntryId, exampleAudio, type Language } from "@kotori/db"
import { asc, eq, gte, inArray, sum } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

// The clip library's rows: each clip's metadata (its bytes are in a bucket or `audio_files`, see AudioStore),
// and which clips read each headword and each example sentence.

/** How an example clip's voice was chosen, kept for debugging and re-casting. */
export type Casting = Pick<typeof exampleAudio.$inferInsert, "castBy" | "score">

export const findAudio = (db: DatabaseShape, key: string) =>
  db
    .select()
    .from(audio)
    .where(eq(audio.key, key))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

export const saveAudio = (db: DatabaseShape, row: typeof audio.$inferInsert) =>
  db.insert(audio).values(row).onConflictDoNothing().pipe(Effect.asVoid, Effect.orDie)

/** Adds a headword clip to the entry; an entry has one clip per dictionary voice. */
export const linkEntryAudio = (db: DatabaseShape, entryId: EntryId, key: string) =>
  db.insert(entryAudio).values({ entryId, audioKey: key }).onConflictDoNothing().pipe(Effect.asVoid, Effect.orDie)

export const linkExampleAudio = (
  db: DatabaseShape,
  exampleId: number,
  language: Language,
  key: string,
  casting?: Casting
) => {
  const row = { audioKey: key, castBy: casting?.castBy ?? null, score: casting?.score ?? null }
  return db
    .insert(exampleAudio)
    .values({ exampleId, language, ...row })
    .onConflictDoUpdate({ target: [exampleAudio.exampleId, exampleAudio.language], set: row })
    .pipe(Effect.asVoid, Effect.orDie)
}

/** Headword clips per entry, oldest first, with the cast voice that reads each. */
export const entryClips = Effect.fn("audio.entryClips")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  const clips = new Map<EntryId, Array<{ readonly key: string; readonly voice: string | null }>>()
  if (entryIds.length === 0) return clips
  const rows = yield* db
    .select({ entryId: entryAudio.entryId, key: entryAudio.audioKey, voice: audio.voice })
    .from(entryAudio)
    .innerJoin(audio, eq(audio.key, entryAudio.audioKey))
    .where(inArray(entryAudio.entryId, entryIds))
    .orderBy(asc(audio.createdAt), asc(audio.key))
  for (const { entryId, ...clip } of rows) {
    const list = clips.get(entryId)
    if (list === undefined) clips.set(entryId, [clip])
    else list.push(clip)
  }
  return clips
}, Effect.orDie)

/** Audio keys per example, as `${exampleId}:${language}`. */
export const exampleClips = Effect.fn("audio.exampleClips")(function* (
  db: DatabaseShape,
  exampleIds: ReadonlyArray<number>
) {
  if (exampleIds.length === 0) return new Map<string, string>()
  const rows = yield* db.select().from(exampleAudio).where(inArray(exampleAudio.exampleId, exampleIds))
  return new Map(rows.map((row) => [`${row.exampleId}:${row.language}`, row.audioKey]))
}, Effect.orDie)

/** Characters sent to the speech provider since `since`, for the monthly budget. */
export const audioCharactersSince = (db: DatabaseShape, since: Date) =>
  db
    .select({ n: sum(audio.characters).mapWith(Number) })
    .from(audio)
    .where(gte(audio.createdAt, since))
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )
