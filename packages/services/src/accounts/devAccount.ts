import { Auth } from "@kotori/auth"
import { at, authUsers, Database } from "@kotori/db"
import { users } from "@kotori/db/schema"
import { type Language, otherLanguage } from "@kotori/domain"
import { eq } from "drizzle-orm"
import { Clock, Effect, Option } from "effect"
import { identityByEmail } from "./identity.ts"

/**
 * Creates the local development account, or repairs one left from an earlier run:
 * confirmed, approved and past the language picker, so the app opens onto the tabs and
 * testing skips sign-up, the confirmation code and waiting for approval.
 */
export const ensureDevAccount = Effect.fn("accounts.ensureDevAccount")(
  function* (options: {
    readonly email: string
    readonly password: string
    readonly nativeLanguage: Language
    readonly admin: boolean
  }) {
    const db = yield* Database
    const existing = yield* identityByEmail(options.email)
    const user = Option.isSome(existing)
      ? existing.value
      : yield* (yield* Auth).signUp({ email: options.email, password: options.password, name: "Dev Learner" })

    // The real path is the learner entering the code Managed Auth's webhook emailed them.
    yield* db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, user.id))
    const now = at(yield* Clock.currentTimeMillis)
    const settings = {
      status: "approved" as const,
      role: options.admin ? ("admin" as const) : ("user" as const),
      nativeLanguage: options.nativeLanguage,
      targetLanguage: otherLanguage(options.nativeLanguage),
      onboardedAt: now
    }
    yield* db
      .insert(users)
      .values({ id: user.id, ...settings, displayName: user.name.trim() || null, createdAt: now })
      .onConflictDoUpdate({ target: users.id, set: settings })
    return { user, created: Option.isNone(existing) }
  },
  Effect.catchTag("EffectDrizzleQueryError", Effect.die)
)
