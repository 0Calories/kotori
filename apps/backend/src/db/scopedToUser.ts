import { type coachUsage, type notes, type UserId } from "@kotori/db"
import { and, eq, type SQL } from "drizzle-orm"
import type { DatabaseShape } from "./Database.ts"

type LearnerTable = typeof notes | typeof coachUsage

export interface Learner {
  readonly db: DatabaseShape
  readonly userId: UserId
  owns(table: LearnerTable, ...conditions: ReadonlyArray<SQL | undefined>): SQL
}

export const scopedToUser = (db: DatabaseShape, userId: UserId): Learner => ({
  db,
  userId,
  owns: (table, ...conditions) => {
    const own = eq(table.userId, userId)
    return and(own, ...conditions) ?? own
  }
})
