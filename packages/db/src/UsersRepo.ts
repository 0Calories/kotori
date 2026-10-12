import { Language } from "@kotori/domain"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

export const UserRow = Schema.Struct({
  id: Schema.String,
  tokenHash: Schema.String,
  nativeLanguage: Language,
  targetLanguage: Language,
  displayName: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  dailyNewLimit: Schema.Int,
  dailyReviewLimit: Schema.Int,
  createdAt: Schema.Number
})
export type UserRow = typeof UserRow.Type

/** Fields to change; undefined leaves a field as it is. */
export type UserPatch = {
  readonly [K in "nativeLanguage" | "targetLanguage" | "displayName" | "timezone" | "dailyNewLimit" | "dailyReviewLimit"]?:
    | UserRow[K]
    | undefined
}

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(UserRow))

export class UsersRepo extends Context.Service<UsersRepo, {
  create(user: UserRow): Effect.Effect<void>
  byTokenHash(tokenHash: string): Effect.Effect<Option.Option<UserRow>>
  byId(id: string): Effect.Effect<Option.Option<UserRow>>
  update(id: string, patch: UserPatch): Effect.Effect<Option.Option<UserRow>>
}>()("@kotori/db/UsersRepo") {
  static readonly layer = Layer.effect(
    UsersRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const create = (user: UserRow) => sql`INSERT INTO users ${sql.insert(user)}`.pipe(Effect.asVoid, Effect.orDie)

      const first = (rows: ReadonlyArray<UserRow>) => Option.fromNullishOr(rows[0])

      const byTokenHash = (tokenHash: string) =>
        sql`SELECT * FROM users WHERE token_hash = ${tokenHash}`.pipe(
          Effect.flatMap(decodeRows),
          Effect.map(first),
          Effect.orDie
        )

      const byId = (id: string) =>
        sql`SELECT * FROM users WHERE id = ${id}`.pipe(Effect.flatMap(decodeRows), Effect.map(first), Effect.orDie)

      const update = Effect.fn("UsersRepo.update")(function*(id: string, patch: UserPatch) {
        const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
        if (Object.keys(fields).length > 0) {
          yield* sql`UPDATE users SET ${sql.update(fields)} WHERE id = ${id}`.pipe(Effect.orDie)
        }
        return yield* byId(id)
      })

      return UsersRepo.of({ create, byTokenHash, byId, update })
    })
  )
}
