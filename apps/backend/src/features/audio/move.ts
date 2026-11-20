import { audioFiles } from "@kotori/db"
import { count, eq, gt, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { createHash } from "node:crypto"
import type { DatabaseShape } from "../../db/Database.ts"
import { Bucket } from "../../integrations/storage/Bucket.ts"
import { CLIP_HEADERS, clipObject } from "./AudioStore.ts"

export interface MoveClipsOptions {
  readonly batch: number
  readonly concurrency: number
  readonly onProgress?: (progress: { readonly moved: number; readonly bytes: number }) => Effect.Effect<void>
}

// Single-part S3 uploads usually set ETag to the MD5 hex digest; fall back to a full GET only when ETag differs.
const holds = Effect.fn("audio.holds")(function* (key: string, bytes: Uint8Array) {
  const bucket = yield* Bucket
  const head = yield* bucket.head(clipObject(key))
  if (Option.isNone(head) || head.value.size !== bytes.byteLength) return false
  if (head.value.etag === createHash("md5").update(bytes).digest("hex")) return true
  const stored = yield* bucket.get(clipObject(key))
  return Option.isSome(stored) && Buffer.from(stored.value).equals(Buffer.from(bytes))
})

export const moveClipsToBucket = Effect.fn("audio.moveClipsToBucket")(function* (
  db: DatabaseShape,
  options: MoveClipsOptions
) {
  const bucket = yield* Bucket
  let after = ""
  let moved = 0
  let bytes = 0
  const unverified: Array<string> = []
  while (true) {
    const rows = yield* db
      .select({ key: audioFiles.key, data: audioFiles.data })
      .from(audioFiles)
      .where(gt(audioFiles.key, after))
      .orderBy(audioFiles.key)
      .limit(options.batch)
      .pipe(Effect.orDie)
    const last = rows.at(-1)
    if (last === undefined) break
    after = last.key
    yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const data = new Uint8Array(row.data)
          yield* bucket.put(clipObject(row.key), data, CLIP_HEADERS)
          if (!(yield* holds(row.key, data))) return unverified.push(row.key)
          yield* db.delete(audioFiles).where(eq(audioFiles.key, row.key)).pipe(Effect.orDie)
          moved++
          bytes += data.byteLength
        }),
      { concurrency: options.concurrency, discard: true }
    )
    if (options.onProgress) yield* options.onProgress({ moved, bytes })
  }
  const [left] = yield* db.select({ n: count() }).from(audioFiles).pipe(Effect.orDie)
  const truncated = (left?.n ?? 0) === 0
  // TRUNCATE reclaims table disk pages immediately, whereas DELETE only marks tuples reusable.
  if (truncated) yield* db.execute(sql`TRUNCATE ${audioFiles}`).pipe(Effect.orDie)
  return { moved, bytes, unverified, truncated }
})
