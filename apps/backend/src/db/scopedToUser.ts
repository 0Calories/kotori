import { type coachUsage, type notes, type reviewLogs, type UserId } from "@kotori/db"
import { and, eq, type SQL } from "drizzle-orm"
import type { DatabaseShape } from "./Database.ts"

/** The tables whose every row belongs to one learner, named by its `user_id`. */
type LearnerTable = typeof notes | typeof reviewLogs | typeof coachUsage

/**
 * The database as one learner sees it. Queries on a learner's data take this instead of the bare
 * handle and filter each table they touch through `owns` (relational reads by `userId`), so whose
 * data a query reads is in its signature, and forgetting the condition takes deliberately reaching
 * past it.
 */
export interface Learner {
  readonly db: DatabaseShape
  readonly userId: UserId
  /** `table.user_id = userId`, with any further conditions. */
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
