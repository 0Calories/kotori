#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Command } from "effect/cli"
import { adminCommand, approve, archive, devAccount, requests, revoke, users } from "../cli/accounts.ts"
import { enrich } from "../cli/enrich.ts"
import { evaluate } from "../cli/evaluate.ts"
import { frequency } from "../cli/frequency.ts"
import { judge } from "../cli/judge.ts"
import { migrate } from "../cli/migrate.ts"
import { proposalsCommand } from "../cli/proposals.ts"
import { seed } from "../cli/seed.ts"
import { status } from "../cli/status.ts"
import { storage } from "../cli/storage.ts"
import { DatabaseLive } from "../db/Database.ts"
import { AccountsLive, EvalLive, FrequencyLive, JudgeLive, RedoLive, SeedLive } from "../runtime/CliLayers.ts"
import { loadDotEnv } from "../runtime/Paths.ts"
import { loggerLayer, SentryLive } from "../runtime/Sentry.ts"
import { WorkerLive } from "../runtime/WorkerLayers.ts"

loadDotEnv()

// Each command builds only the services it uses, so `kotori migrate` (Fly's release command)
// needs nothing but DATABASE_URL, and a missing API key fails only the command that calls it.
const kotori = Command.make("kotori").pipe(
  Command.withDescription("Kotori's toolbox: seed and enrich the dictionary, and manage learner sign-ups"),
  Command.withSubcommands([
    migrate.pipe(Command.provide(DatabaseLive)),
    proposalsCommand(RedoLive).pipe(Command.provide(DatabaseLive)),
    seed.pipe(Command.provide(SeedLive)),
    enrich.pipe(Command.provide(WorkerLive)),
    frequency.pipe(Command.provide(FrequencyLive)),
    judge.pipe(Command.provide(JudgeLive)),
    evaluate.pipe(Command.provide(EvalLive)),
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

kotori.pipe(
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  Effect.provide(Layer.merge(loggerLayer(), SentryLive("cli"))),
  NodeRuntime.runMain
)
