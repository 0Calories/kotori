import { Language } from "@kotori/domain"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

/** The learner profile. Identity (email, credentials, sessions) lives in Better Auth; `id` is its user id. */
export const UserRow = Schema.Struct({
  id: Schema.String,
  nativeLanguage: Language,
  targetLanguage: Language,
  /** When the learner picked a language; null until onboarding is done. */
  onboardedAt: Schema.NullOr(Schema.Number),
  displayName: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  dailyNewLimit: Schema.Int,
  dailyReviewLimit: Schema.Int,
  createdAt: Schema.Number
})
export type UserRow = typeof UserRow.Type

/** Fields to change; undefined leaves a field as it is. */
export type UserPatch = {
  readonly [
    K in
      | "nativeLanguage"
      | "targetLanguage"
      | "onboardedAt"
      | "displayName"
      | "timezone"
      | "dailyNewLimit"
      | "dailyReviewLimit"
  ]?: UserRow[K] | undefined
}

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(UserRow))

export class UsersRepo extends Context.Service<
  UsersRepo,
  {
    /** Creates the profile if it doesn't exist yet and returns it either way. */
    ensure(user: UserRow): Effect.Effect<UserRow>
    byId(id: string): Effect.Effect<Option.Option<UserRow>>
    update(id: string, patch: UserPatch): Effect.Effect<Option.Option<UserRow>>
    /** Removes the profile and everything the learner saved or studied. */
    delete(id: string): Effect.Effect<void>
  }
>()("@kotori/db/UsersRepo") {
  static readonly layer = Layer.effect(
    UsersRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const first = (rows: ReadonlyArray<UserRow>) => Option.fromNullishOr(rows[0])

      const byId = (id: string) =>
        sql`SELECT * FROM users WHERE id = ${id}`.pipe(Effect.flatMap(decodeRows), Effect.map(first), Effect.orDie)

      const ensure = Effect.fn("UsersRepo.ensure")(function* (user: UserRow) {
        yield* sql`INSERT INTO users ${sql.insert(user)} ON CONFLICT (id) DO NOTHING`.pipe(Effect.orDie)
        return Option.getOrElse(yield* byId(user.id), () => user)
      })

      const update = Effect.fn("UsersRepo.update")(function* (id: string, patch: UserPatch) {
        const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
        if (Object.keys(fields).length > 0) {
          yield* sql`UPDATE users SET ${sql.update(fields)} WHERE id = ${id}`.pipe(Effect.orDie)
        }
        return yield* byId(id)
      })

      // notes → cards → review_logs cascade from users; coach_usage has no key.
      const del = Effect.fn("UsersRepo.delete")(function* (id: string) {
        yield* sql`DELETE FROM coach_usage WHERE user_id = ${id}`.pipe(Effect.orDie)
        yield* sql`DELETE FROM users WHERE id = ${id}`.pipe(Effect.orDie)
      })

      return UsersRepo.of({ ensure, byId, update, delete: del })
    })
  )
}
