import { migrateDatabase, migrationsFolder } from "@kotori/db"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"

/** What to do about a database from before the Drizzle rebuild. Its contents don't carry over. */
const legacyHelp = `
Nothing was changed. The dictionary and enrichment are rebuilt by seeding, but accounts, notes and
review history in this database are not carried over. To start again on the new schema:

  Local Docker Postgres:  docker compose down -v   (deletes the local database), then pnpm dev:setup
  A Neon branch:          reset the branch, then run kotori migrate and kotori seed again`

export const migrate = Command.make(
  "migrate",
  {},
  Effect.fn(function* () {
    yield* Console.log(`Applying migrations from ${migrationsFolder}`)
    yield* migrateDatabase().pipe(
      Effect.andThen(Console.log("The database schema is up to date.")),
      Effect.catchTag("LegacySchemaError", (error) =>
        Console.error(`\n${error.message}\n${legacyHelp}`).pipe(
          // A clean exit code would let a deploy or `pnpm dev:setup` carry on regardless.
          Effect.andThen(Effect.sync(() => void (process.exitCode = 1)))
        )
      )
    )
  })
).pipe(Command.withDescription("Apply pending database migrations; runs before the API and worker start"))
