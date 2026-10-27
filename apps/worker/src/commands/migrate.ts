import { migrateDatabase, migrationsFolder } from "@kotori/db"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"

export const migrate = Command.make(
  "migrate",
  {},
  Effect.fn(function* () {
    yield* Console.log(`Applying migrations from ${migrationsFolder}`)
    yield* migrateDatabase()
    yield* Console.log("The database schema is up to date.")
  })
).pipe(Command.withDescription("Apply pending database migrations; runs before the API and worker start"))
