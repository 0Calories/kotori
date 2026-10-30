#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node"
import { loadDotEnv } from "@kotori/db"
import { Effect } from "effect"
import { Command } from "effect/cli"
import { adminCommand, approve, archive, devAccount, requests, revoke, users } from "./commands/accounts.ts"
import { enrich } from "./commands/enrich.ts"
import { evaluate } from "./commands/evaluate.ts"
import { migrate } from "./commands/migrate.ts"
import { seed } from "./commands/seed.ts"
import { status } from "./commands/status.ts"
import { work } from "./commands/work.ts"
import { WorkerLive } from "./layers.ts"

loadDotEnv()

const kotori = Command.make("kotori").pipe(
  Command.withDescription("Kotori's toolbox: seed and enrich the dictionary, and manage learner sign-ups"),
  Command.withSubcommands([
    migrate,
    seed,
    enrich,
    evaluate,
    work,
    status,
    requests,
    approve,
    archive,
    users,
    adminCommand,
    revoke,
    devAccount
  ])
)

kotori.pipe(Command.run({ version: "0.1.0" }), Effect.provide(WorkerLive), NodeRuntime.runMain)
