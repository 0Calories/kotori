import { PgClient } from "@effect/sql-pg"
import { Console, Effect, FileSystem, Option, Redacted } from "effect"
import { Command, Flag } from "effect/cli"
import { SqlClient } from "effect/sql"
import { Database } from "../db/Database.ts"
import { type LegacyNote, recoverNotes } from "../features/notebook/recover.ts"

interface LegacyRow {
  readonly id: string
  readonly userId: string
  readonly kind: string
  readonly entryId: string | null
  readonly content: unknown
  readonly createdAt: Date | string
}

/** Every note in a database from before `20261120182449_remove_srs`, over its own connection. */
const readLegacyNotes = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<LegacyRow>`
      SELECT id::text AS "id", user_id::text AS "userId", kind::text AS "kind",
             entry_id::text AS "entryId", content AS "content", created_at AS "createdAt"
      FROM notes`
    return rows.map((row): LegacyNote => ({
      ...row,
      content: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
      createdAt: new Date(row.createdAt)
    }))
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })))

const recover = Command.make(
  "recover",
  {
    from: Flag.String("from").pipe(
      Flag.withDescription(
        "Connection string of a database that still has the old notes, e.g. a Neon branch restored to before the remove_srs migration"
      )
    ),
    apply: Flag.Boolean("apply").pipe(
      Flag.withDescription("Write the notes back; without it, only report what would be restored"),
      Flag.withDefault(false)
    ),
    skipped: Flag.String("skipped").pipe(
      Flag.withDescription("Write the notes that can't be restored, with their content, to this JSON file"),
      Flag.optional
    )
  },
  Effect.fn(function* ({ from, apply, skipped }) {
    const db = yield* Database
    const legacy = yield* readLegacyNotes(from)
    const report = yield* recoverNotes(db, legacy, { apply })

    const reasons = new Map<string, number>()
    for (const { reason } of report.skipped) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    yield* Console.log(
      `${legacy.length.toLocaleString()} legacy notes; ${apply ? "restored" : "would restore"} ${report.restored.toLocaleString()}.`
    )
    for (const [reason, count] of reasons) yield* Console.log(`  skipped ${count.toLocaleString()}: ${reason}`)

    if (Option.isSome(skipped)) {
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString(
        skipped.value,
        JSON.stringify(
          report.skipped.map(({ note, reason }) => ({ reason, ...note })),
          null,
          2
        )
      )
      yield* Console.log(`Wrote the skipped notes to ${skipped.value}.`)
    }
    if (!apply) yield* Console.log("Dry run: nothing was written. Pass --apply to restore.")
  })
).pipe(
  Command.withDescription(
    "Restore Notebook notes deleted by the remove_srs migration, reading them from a database restored to before it"
  )
)

export const notesCommand = Command.make("notes").pipe(
  Command.withDescription("Manage learners' saved notes"),
  Command.withSubcommands([recover])
)
