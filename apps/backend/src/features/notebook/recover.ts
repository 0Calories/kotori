import {
  englishEntryId,
  entries,
  type EntryId,
  isEntryId,
  jmdictEntryId,
  NoteId,
  notes,
  UserId,
  users
} from "@kotori/db"
import { inArray } from "drizzle-orm"
import { Effect, Match } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

/**
 * A row of the `notes` table as it was before `20261120182449_remove_srs` dropped its `kind`
 * and `content` columns and deleted every note whose `entry_id` `20261120022207` had nulled.
 * Read from a database that still has them: a Neon branch restored to before that migration.
 */
export interface LegacyNote {
  readonly id: string
  readonly userId: string
  readonly kind: string
  /** The column, as text: an integer before `20261120022207`, null after it, a new id for notes saved since. */
  readonly entryId: string | null
  /** The note's frozen `content` JSONB; word notes kept their entry's old integer id and headword here. */
  readonly content: unknown
  readonly createdAt: Date
}

/** Below this, an old integer `EntryId` was JMDict's `ent_seq`. */
const FIRST_ENGLISH_ID = 100_000_000
/** From this up, an old id was a Japanese word approved out of Ask Kotori; those entries were not carried over. */
const FIRST_APPROVED_JA_ID = 200_000_000

/** Why a legacy note can't come back as a Notebook note. */
export type Unrecoverable =
  | "phrase" // a Coach or hand-typed phrase: the Notebook only saves dictionary entries
  | "approved-entry" // an Ask Kotori word under an old integer id, whose entry is gone
  | "unreadable" // no entry id in the column or the content
  | "missing-entry" // the entry id the note maps to isn't in `entries`
  | "missing-user" // the learner's account no longer exists
  | "already-saved" // the learner already has this entry (or this note) in their Notebook

export type Mapped =
  | { readonly _tag: "entry"; readonly entryId: EntryId }
  | { readonly _tag: "unrecoverable"; readonly reason: Unrecoverable }

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

/** The new string `EntryId` for an old integer one: `jmdict:<seq>`, or `en:<headword>` for the English block. */
const fromLegacyNumber = (id: number, headword: unknown): Mapped => {
  if (!Number.isInteger(id) || id <= 0) return { _tag: "unrecoverable", reason: "unreadable" }
  if (id < FIRST_ENGLISH_ID) return { _tag: "entry", entryId: jmdictEntryId(id) }
  if (id >= FIRST_APPROVED_JA_ID) return { _tag: "unrecoverable", reason: "approved-entry" }
  return typeof headword === "string" && headword.length > 0
    ? { _tag: "entry", entryId: englishEntryId(headword) }
    : { _tag: "unrecoverable", reason: "unreadable" }
}

const fromLegacyValue = (value: unknown, headword: unknown): Mapped | undefined => {
  if (typeof value === "number") return fromLegacyNumber(value, headword)
  if (typeof value !== "string" || value.length === 0) return undefined
  if (isEntryId(value)) return { _tag: "entry", entryId: value }
  return /^\d+$/.test(value) ? fromLegacyNumber(Number(value), headword) : undefined
}

/**
 * Which entry a legacy note saved, from its `entry_id` column when that survived, else from the
 * `entryId` and `headword` frozen in its content.
 */
export const legacyEntryId = (note: LegacyNote): Mapped => {
  const content = record(note.content)
  const kind = typeof content["kind"] === "string" ? content["kind"] : note.kind
  if (kind === "phrase") return { _tag: "unrecoverable", reason: "phrase" }
  return (
    fromLegacyValue(note.entryId, content["headword"]) ??
    fromLegacyValue(content["entryId"], content["headword"]) ?? { _tag: "unrecoverable", reason: "unreadable" }
  )
}

export interface RecoveryReport {
  /** Notes written back (or that would be, on a dry run). */
  readonly restored: number
  readonly skipped: ReadonlyArray<{ readonly note: LegacyNote; readonly reason: Unrecoverable }>
}

/**
 * Writes legacy notes back into the Notebook, keeping each note's id and `created_at`. A note
 * comes back only if its entry and learner exist and the learner hasn't saved that entry since;
 * of several legacy notes on one entry (one per sense, before), the earliest is kept. Runs in
 * one transaction, and changes nothing when `apply` is false.
 */
export const recoverNotes = Effect.fn("notebook.recoverNotes")(function* (
  db: DatabaseShape,
  legacy: ReadonlyArray<LegacyNote>,
  options: { readonly apply: boolean }
) {
  const mapped = legacy.map((note) => ({ note, mapped: legacyEntryId(note) }))
  const entryIds = [...new Set(mapped.flatMap(({ mapped }) => (mapped._tag === "entry" ? [mapped.entryId] : [])))]
  const userIds = [...new Set(legacy.map((note) => note.userId))]

  return yield* db.transaction(() =>
    Effect.gen(function* () {
      const knownEntries = new Set<string>()
      for (let i = 0; i < entryIds.length; i += 1000) {
        const rows = yield* db
          .select({ id: entries.id })
          .from(entries)
          .where(inArray(entries.id, entryIds.slice(i, i + 1000)))
        for (const row of rows) knownEntries.add(row.id)
      }
      const knownUsers = new Set(
        userIds.length === 0
          ? []
          : (yield* db
              .select({ id: users.id })
              .from(users)
              .where(
                inArray(
                  users.id,
                  userIds.map((id) => UserId.make(id))
                )
              )).map((row) => row.id as string)
      )
      const current = yield* db.select({ id: notes.id, userId: notes.userId, entryId: notes.entryId }).from(notes)
      const taken = new Set(current.map((row) => `${row.userId} ${row.entryId}`))
      const takenIds = new Set<string>(current.map((row) => row.id))

      const skipped: Array<{ note: LegacyNote; reason: Unrecoverable }> = []
      const restore: Array<typeof notes.$inferInsert> = []
      const oldestFirst = [...mapped].sort(
        (a, b) => a.note.createdAt.getTime() - b.note.createdAt.getTime() || a.note.id.localeCompare(b.note.id)
      )
      for (const { note, mapped } of oldestFirst) {
        const reason = Match.value(mapped).pipe(
          Match.tag("unrecoverable", ({ reason }) => reason),
          Match.tag("entry", ({ entryId }) => {
            if (!knownEntries.has(entryId)) return "missing-entry" as const
            if (!knownUsers.has(note.userId)) return "missing-user" as const
            const key = `${note.userId} ${entryId}`
            if (taken.has(key) || takenIds.has(note.id)) return "already-saved" as const
            taken.add(key)
            takenIds.add(note.id)
            restore.push({
              id: NoteId.make(note.id),
              userId: UserId.make(note.userId),
              entryId,
              createdAt: note.createdAt
            })
            return undefined
          }),
          Match.exhaustive
        )
        if (reason !== undefined) skipped.push({ note, reason })
      }

      if (options.apply) {
        for (let i = 0; i < restore.length; i += 500) {
          yield* db
            .insert(notes)
            .values(restore.slice(i, i + 500))
            .onConflictDoNothing()
        }
      }
      return { restored: restore.length, skipped } satisfies RecoveryReport
    })
  )
}, Effect.orDie)
