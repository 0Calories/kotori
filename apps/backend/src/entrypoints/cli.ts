#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { Command } from "effect/cli"
import { kotori, VERSION } from "../cli/kotori.ts"
import { loadDotEnv } from "../runtime/Paths.ts"
import { loggerLayer, SentryLive } from "../runtime/Sentry.ts"

loadDotEnv()

kotori.pipe(
  Command.run({ version: VERSION }),
  // A clean exit code would let a deploy or `pnpm dev:setup` carry on regardless.
  Effect.catchTag("CommandFailed", (failure) =>
    Console.error(failure.message).pipe(Effect.andThen(Effect.sync(() => void (process.exitCode = 1))))
  ),
  Effect.provide(NodeServices.layer),
  Effect.provide(Layer.merge(loggerLayer(), SentryLive("cli"))),
  NodeRuntime.runMain
)
