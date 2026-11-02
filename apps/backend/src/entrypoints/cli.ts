#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { DatabaseLive, loadDotEnv } from "@kotori/db"
import { Jev } from "@kotori/nuance"
import { Effect } from "effect"
import { Command } from "effect/cli"
import { adminCommand, approve, archive, devAccount, requests, revoke, users } from "../cli/accounts.ts"
import { enrich } from "../cli/enrich.ts"
import { evaluate } from "../cli/evaluate.ts"
import { golden } from "../cli/golden.ts"
import { migrate } from "../cli/migrate.ts"
import { seed } from "../cli/seed.ts"
import { status } from "../cli/status.ts"
import { AccountsLive, SeedLive } from "../runtime/CliLayers.ts"
import { WorkerLive } from "../runtime/WorkerLayers.ts"

loadDotEnv()

// Each command builds only the services it uses, so `kotori migrate` (Fly's release command)
// needs nothing but DATABASE_URL, and a missing API key fails only the command that calls it.
const kotori = Command.make("kotori").pipe(
  Command.withDescription("Kotori's toolbox: seed and enrich the dictionary, and manage learner sign-ups"),
  Command.withSubcommands([
    migrate.pipe(Command.provide(DatabaseLive)),
    seed.pipe(Command.provide(SeedLive)),
    enrich.pipe(Command.provide(WorkerLive)),
    evaluate.pipe(Command.provide(Jev.layer)),
    golden,
    status.pipe(Command.provide(WorkerLive)),
    requests.pipe(Command.provide(AccountsLive)),
    approve.pipe(Command.provide(AccountsLive)),
    archive.pipe(Command.provide(AccountsLive)),
    users.pipe(Command.provide(AccountsLive)),
    adminCommand.pipe(Command.provide(AccountsLive)),
    revoke.pipe(Command.provide(AccountsLive)),
    devAccount.pipe(Command.provide(AccountsLive))
  ])
)

kotori.pipe(Command.run({ version: "0.1.0" }), Effect.provide(NodeServices.layer), NodeRuntime.runMain)
