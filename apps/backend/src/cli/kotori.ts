import { Jev } from "@kotori/ai"
import { Command } from "effect/cli"
import { DatabaseLive } from "../db/Database.ts"
import { AccountsLive, FamiliarityLive, RedoLive, SeedLive } from "../runtime/CliLayers.ts"
import { WorkerLive } from "../runtime/WorkerLayers.ts"
import { adminCommand, approve, archive, devAccount, requests, revoke, users } from "./accounts.ts"
import { enrich } from "./enrich.ts"
import { evaluate } from "./evaluate.ts"
import { familiarity } from "./familiarity.ts"
import { golden } from "./golden.ts"
import { migrate } from "./migrate.ts"
import { proposalsCommand } from "./proposals.ts"
import { seed } from "./seed.ts"
import { status } from "./status.ts"
import { storage } from "./storage.ts"

export const VERSION = "0.1.0"

/**
 * Every `kotori` command, for the CLI to run from argv and the admin console to run from its forms.
 * Each command builds only the services it uses, so `kotori migrate` (Fly's release command)
 * needs nothing but DATABASE_URL, and a missing API key fails only the command that calls it.
 */
export const kotori = Command.make("kotori").pipe(
  Command.withDescription("Kotori's toolbox: seed and enrich the dictionary, and manage learner sign-ups"),
  Command.withSubcommands([
    migrate.pipe(Command.provide(DatabaseLive)),
    proposalsCommand(RedoLive).pipe(Command.provide(DatabaseLive)),
    seed.pipe(Command.provide(SeedLive)),
    enrich.pipe(Command.provide(WorkerLive)),
    familiarity.pipe(Command.provide(FamiliarityLive)),
    evaluate.pipe(Command.provide(Jev.layer)),
    golden,
    status.pipe(Command.provide(WorkerLive)),
    storage.pipe(Command.provide(DatabaseLive)),
    requests.pipe(Command.provide(AccountsLive)),
    approve.pipe(Command.provide(AccountsLive)),
    archive.pipe(Command.provide(AccountsLive)),
    users.pipe(Command.provide(AccountsLive)),
    adminCommand.pipe(Command.provide(AccountsLive)),
    revoke.pipe(Command.provide(AccountsLive)),
    devAccount.pipe(Command.provide(AccountsLive))
  ])
)
