import { CASTS } from "@kotori/ai"
import { audio, type EntryId, type Language } from "@kotori/db"
import { and, desc, eq, gte, inArray, asc, sum } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

// The clip library's rows: each clip's metadata (its bytes are in a bucket or `audio_files`, see AudioStore).
// Form pronunciation clips resolve deterministically from `audio` by `(language, text)` without an
// entry-audio join table, so clips survive entry rebuilds and identifier changes.

/** The spoken text of an entry's primary form: kana reading for Japanese, headword for English. */
export const spokenForm = (entry: {
  readonly language: Language
  readonly headword: string
  readonly reading: string
}): string => (entry.language === "ja" && entry.reading.trim().length > 0 ? entry.reading : entry.headword).trim()

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

/** Dictionary voice ids eligible for headword pronunciations in `language`, in cast order. */
const headwordVoiceOrder = (language: Language) =>
  new Map(CASTS[language].filter((voice) => voice.tags.headword).map((voice, index) => [voice.id, index] as const))

export interface FormClip {
  readonly key: string
  readonly voice: string | null
}

/**
 * Spoken form pronunciation clips per entry, resolved deterministically from content-addressed
 * `audio` by `(language, spokenForm)` across dictionary voices (plus legacy uncast clips).
 */
export const formClips = Effect.fn("audio.formClips")(function* (
  db: DatabaseShape,
  targets: ReadonlyArray<{
    readonly id: EntryId
    readonly language: Language
    readonly headword: string
    readonly reading: string
  }>
) {
  const clips = new Map<EntryId, Array<FormClip>>()
  if (targets.length === 0) return clips

  const byLanguage = new Map<Language, Set<string>>()
  for (const target of targets) {
    const text = spokenForm(target)
    if (text.length === 0) continue
    const set = byLanguage.get(target.language) ?? new Set<string>()
    set.add(text)
    byLanguage.set(target.language, set)
  }

  const byText = new Map<string, Array<FormClip>>()
  for (const [language, texts] of byLanguage) {
    if (texts.size === 0) continue
    const order = headwordVoiceOrder(language)
    const rows = yield* db
      .select({ text: audio.text, key: audio.key, voice: audio.voice, createdAt: audio.createdAt })
      .from(audio)
      .where(and(eq(audio.language, language), inArray(audio.text, [...texts])))
      .orderBy(desc(audio.createdAt), asc(audio.key))

    const grouped = new Map<string, Array<{ readonly key: string; readonly voice: string | null }>>()
    for (const row of rows) {
      if (row.voice !== null && !order.has(row.voice)) continue
      const list = grouped.get(row.text) ?? []
      list.push({ key: row.key, voice: row.voice })
      grouped.set(row.text, list)
    }

    for (const [text, list] of grouped) {
      // Deterministic cast order (named dictionary voices first, legacy uncast clips after), one clip per named voice.
      const sorted = list.toSorted((a, b) => {
        const orderA = a.voice === null ? Number.MAX_SAFE_INTEGER : (order.get(a.voice) ?? Number.MAX_SAFE_INTEGER)
        const orderB = b.voice === null ? Number.MAX_SAFE_INTEGER : (order.get(b.voice) ?? Number.MAX_SAFE_INTEGER)
        return orderA - orderB
      })
      const seenVoices = new Set<string>()
      const deduped: Array<FormClip> = []
      for (const clip of sorted) {
        if (clip.voice !== null) {
          if (seenVoices.has(clip.voice)) continue
          seenVoices.add(clip.voice)
        }
        deduped.push(clip)
      }
      byText.set(`${language}\u0000${text}`, deduped)
    }
  }

  for (const target of targets) {
    const found = byText.get(`${target.language}\u0000${spokenForm(target)}`)
    if (found !== undefined && found.length > 0) clips.set(target.id, found)
  }
  return clips
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
