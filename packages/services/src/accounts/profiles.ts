import type { AuthUser } from "@kotori/auth"
import { at, authUsers, Database, millis } from "@kotori/db"
import { users } from "@kotori/db/schema"
import { type Language, otherLanguage, type Profile, type UpdateProfileRequest, UserId } from "@kotori/domain"
import { eq } from "drizzle-orm"
import { Clock, Effect, Option } from "effect"
import { isTimeZone } from "../time.ts"

// The learner profile: identity comes from Managed Better Auth; approval, role and
// preferences are Kotori's own, on the `users` row, which is created on first sight.

type ProfileRow = typeof users.$inferSelect

/** What the profile shows from the auth user: contact details the row doesn't duplicate. */
type Identity = Pick<AuthUser, "email" | "emailVerified">

const toProfile = (who: Identity, row: ProfileRow): Profile => ({
  id: UserId.make(row.id),
  email: who.email,
  emailVerified: who.emailVerified,
  status: row.status,
  role: row.role,
  nativeLanguage: row.nativeLanguage,
  targetLanguage: row.targetLanguage,
  onboarded: row.onboardedAt !== null,
  displayName: row.displayName,
  timezone: row.timezone,
  dailyNewLimit: row.dailyNewLimit,
  dailyReviewLimit: row.dailyReviewLimit,
  createdAt: millis(row.createdAt)
})

/** The language Kotori emails a learner in: the one they picked in the app, English until then. */
export const emailLanguage = (row: ProfileRow | undefined): Language =>
  row === undefined || row.onboardedAt === null ? "en" : row.nativeLanguage

export const profileRow = Effect.fn("accounts.profileRow")(function* (id: string) {
  const db = yield* Database
  const rows = yield* db.select().from(users).where(eq(users.id, id))
  return Option.fromNullishOr(rows[0])
}, Effect.orDie)

/** The learner's profile row, created pending with the schema's defaults if they haven't been seen yet. */
export const ensureProfile = Effect.fn("accounts.ensureProfile")(function* (user: AuthUser) {
  const db = yield* Database
  const createdAt = at(yield* Clock.currentTimeMillis)
  yield* db
    .insert(users)
    .values({ id: user.id, displayName: user.name.trim() || null, createdAt })
    .onConflictDoNothing()
    .pipe(Effect.orDie)
  return Option.getOrThrow(yield* profileRow(user.id))
})

/** The profile for a signed-in user, created on first sight. */
export const profile = Effect.fn("accounts.profile")(function* (user: AuthUser) {
  return toProfile(user, yield* ensureProfile(user))
})

/** Changes the learner's preferences. Picking a language is what completes onboarding. */
export const update = Effect.fn("accounts.update")(function* (current: Profile, request: UpdateProfileRequest) {
  const db = yield* Database
  const now = yield* Clock.currentTimeMillis
  const changes = {
    nativeLanguage: request.nativeLanguage,
    targetLanguage: request.nativeLanguage === undefined ? undefined : otherLanguage(request.nativeLanguage),
    onboardedAt: request.nativeLanguage === undefined ? undefined : at(now),
    displayName: request.displayName === undefined ? undefined : request.displayName?.trim() || null,
    timezone: request.timezone !== undefined && isTimeZone(request.timezone) ? request.timezone : undefined,
    dailyNewLimit: request.dailyNewLimit,
    dailyReviewLimit: request.dailyReviewLimit
  }
  // Undefined leaves a field as it is; Drizzle skips undefined values but needs at least one.
  if (Object.values(changes).every((value) => value === undefined)) return current
  const [row] = yield* db.update(users).set(changes).where(eq(users.id, current.id)).returning().pipe(Effect.orDie)
  return row === undefined ? current : toProfile(current, row)
})

/**
 * Removes the learner's data, their identity and their sessions, all or nothing: a profile
 * deleted without its identity would be recreated, pending, on the learner's next request.
 * Notes, cards, review logs and coach usage cascade from the profile, sessions from the identity.
 */
export const remove = Effect.fn("accounts.remove")(function* (id: UserId) {
  const db = yield* Database
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(users).where(eq(users.id, id))
      yield* tx.delete(authUsers).where(eq(authUsers.id, id))
    })
  )
}, Effect.orDie)
