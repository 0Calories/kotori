import type { AccountStatus, CardQueue, CardTemplate, Language, NoteContent, Rating } from "@kotori/domain"
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"
import { createdAt, table, timestamptz } from "./columns.ts"
import { entries } from "./dictionary.ts"
import { language } from "./dictionary.ts"

// The learner: profile, what they study and how it went. Everything cascades from `users`.

export const accountStatus = pgEnum("account_status", ["pending", "approved", "archived"])
export const userRole = pgEnum("user_role", ["user", "admin"])

/**
 * The learner profile. Identity (email, credentials, sessions) is Managed Better Auth's,
 * in the `neon_auth` schema of the same database; `id` is its user id and the row is
 * created on the learner's first request. Approval `status` and `role` are Kotori's own.
 * No foreign key into `neon_auth`: that schema is Neon's to change.
 */
export const users = table(
  "users",
  {
    id: uuid().primaryKey(),
    status: accountStatus().$type<AccountStatus>().notNull().default("pending"),
    role: userRole().notNull().default("user"),
    nativeLanguage: language().$type<Language>().notNull().default("en"),
    targetLanguage: language().$type<Language>().notNull().default("ja"),
    /** When the learner picked a language; null until onboarding is done. */
    onboardedAt: timestamptz(),
    displayName: text(),
    /** IANA time zone; study days roll over at 4am local time. */
    timezone: text().notNull().default("UTC"),
    dailyNewLimit: integer().notNull().default(20),
    dailyReviewLimit: integer().notNull().default(200),
    createdAt: createdAt()
  },
  (t) => [index("users_status").on(t.status)]
)

export const noteKind = pgEnum("note_kind", ["word", "phrase"])

/** Something a learner saved to study: a dictionary sense, or a phrase from the coach or typed by hand. */
export const notes = table(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: noteKind().notNull(),
    /** What is shown on the cards, frozen at save time so later enrichment changes don't rewrite a learner's card. */
    content: jsonb().$type<NoteContent>().notNull(),
    /** For word notes, the dictionary sense they came from. */
    entryId: integer().references(() => entries.id, { onDelete: "set null" }),
    sense: integer(),
    createdAt: createdAt()
  },
  (t) => [
    index("notes_user").on(t.userId, t.createdAt),
    uniqueIndex("notes_word")
      .on(t.userId, t.entryId, t.sense)
      .where(sql`${t.entryId} IS NOT NULL`)
  ]
)

export const cardTemplate = pgEnum("card_template", ["recognize", "produce"])
export const cardQueue = pgEnum("card_queue", ["new", "learning", "review", "relearning"])

/** One side of a note to review, with its spaced-repetition state. */
export const cards = table(
  "cards",
  {
    id: uuid().primaryKey().defaultRandom(),
    noteId: uuid()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    template: cardTemplate().$type<CardTemplate>().notNull(),
    queue: cardQueue().$type<CardQueue>().notNull().default("new"),
    due: timestamptz().notNull(),
    /** Days between reviews once the card graduates. */
    interval: integer().notNull().default(0),
    ease: doublePrecision().notNull().default(0),
    /** Position in the learning steps while in `learning` or `relearning`. */
    step: integer().notNull().default(0),
    reps: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    leech: boolean().notNull().default(false),
    lastReview: timestamptz(),
    /** Random tie-breaker so due cards don't always come in the same order. */
    seed: integer().notNull(),
    /** Order new cards are introduced in. */
    position: integer().notNull(),
    createdAt: createdAt()
  },
  (t) => [index("cards_queue").on(t.userId, t.queue, t.due), index("cards_note").on(t.noteId)]
)

export const rating = pgEnum("rating", ["again", "hard", "good", "easy"])

/** Every answer, with the card's state before and after, for statistics and tuning. */
export const reviewLogs = table(
  "review_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    cardId: uuid()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: rating().$type<Rating>().notNull(),
    queueBefore: cardQueue().$type<CardQueue>().notNull(),
    intervalBefore: integer().notNull(),
    interval: integer().notNull(),
    easeBefore: doublePrecision().notNull(),
    ease: doublePrecision().notNull(),
    /** How late the review was, in milliseconds (negative when early). */
    delayMs: bigint({ mode: "number" }).notNull(),
    /** How long the learner took to answer, when the client reported it. */
    durationMs: integer(),
    reviewedAt: timestamptz().notNull(),
    /** The learner's local study day (days since epoch, rolling over at 4am), so streaks and "today" don't depend on the server clock. */
    studyDay: integer().notNull()
  },
  (t) => [index("review_logs_user_day").on(t.userId, t.studyDay)]
)

/** Coach answers cached by request hash, so the same question isn't paid for twice. */
export const coachCache = table("coach_cache", {
  key: text().primaryKey(),
  result: jsonb().notNull(),
  createdAt: createdAt()
})

export const coachKind = pgEnum("coach_kind", ["naturalness", "how-to-say", "speak"])

/** One row per coach request, for the per-learner hourly rate limit. */
export const coachUsage = table(
  "coach_usage",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: coachKind().notNull(),
    createdAt: createdAt()
  },
  (t) => [index("coach_usage_user").on(t.userId, t.createdAt)]
)
