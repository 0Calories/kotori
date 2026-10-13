import { type UserRow, UsersRepo } from "@kotori/db"
import {
  type CreateAccountRequest,
  otherLanguage,
  type Profile,
  type Session,
  type UpdateProfileRequest,
  UserId
} from "@kotori/domain"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { isTimeZone } from "./time.ts"

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export const toProfile = (row: UserRow): Profile => ({
  id: UserId.make(row.id),
  nativeLanguage: row.nativeLanguage,
  targetLanguage: row.targetLanguage,
  displayName: row.displayName,
  timezone: row.timezone,
  dailyNewLimit: row.dailyNewLimit,
  dailyReviewLimit: row.dailyReviewLimit,
  createdAt: row.createdAt
})

/** Accounts are created on first launch and identified by a bearer token kept on the device. */
export class Accounts extends Context.Service<Accounts, {
  create(request: CreateAccountRequest): Effect.Effect<Session>
  authenticate(token: string): Effect.Effect<Option.Option<Profile>>
  update(id: UserId, request: UpdateProfileRequest): Effect.Effect<Option.Option<Profile>>
}>()("@kotori/api/Accounts") {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function*() {
      const users = yield* UsersRepo

      const create = Effect.fn("Accounts.create")(function*(request: CreateAccountRequest) {
        const token = `kt_${randomBytes(32).toString("base64url")}`
        const row: UserRow = {
          id: randomUUID(),
          tokenHash: hashToken(token),
          nativeLanguage: request.nativeLanguage,
          targetLanguage: otherLanguage(request.nativeLanguage),
          displayName: request.displayName?.trim() || null,
          timezone: isTimeZone(request.timezone) ? request.timezone : "UTC",
          dailyNewLimit: 20,
          dailyReviewLimit: 200,
          createdAt: yield* Clock.currentTimeMillis
        }
        yield* users.create(row)
        return { token, profile: toProfile(row) }
      })

      const authenticate = (token: string) => users.byTokenHash(hashToken(token)).pipe(Effect.map(Option.map(toProfile)))

      const update = Effect.fn("Accounts.update")(function*(id: UserId, request: UpdateProfileRequest) {
        const updated = yield* users.update(id, {
          nativeLanguage: request.nativeLanguage,
          targetLanguage: request.nativeLanguage === undefined ? undefined : otherLanguage(request.nativeLanguage),
          displayName: request.displayName === undefined ? undefined : request.displayName?.trim() || null,
          timezone: request.timezone !== undefined && isTimeZone(request.timezone) ? request.timezone : undefined,
          dailyNewLimit: request.dailyNewLimit,
          dailyReviewLimit: request.dailyReviewLimit
        })
        return Option.map(updated, toProfile)
      })

      return Accounts.of({ create, authenticate, update })
    })
  )
}
