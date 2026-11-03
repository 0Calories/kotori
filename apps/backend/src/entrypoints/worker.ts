import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { loadDotEnv } from "../runtime/Paths.ts"
import { loggerLayer, SentryLive } from "../runtime/Sentry.ts"
import { WorkerLive } from "../runtime/WorkerLayers.ts"
import { work } from "../worker/work.ts"

loadDotEnv()

/** Polling interval while the queue is empty. */
const IDLE = "2 seconds"

work(IDLE).pipe(
  Effect.provide(WorkerLive),
  Effect.provide(Layer.merge(loggerLayer(), SentryLive("worker"))),
  NodeRuntime.runMain
)
