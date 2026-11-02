import { NodeRuntime } from "@effect/platform-node"
import { loadDotEnv } from "@kotori/db"
import { Effect } from "effect"
import { WorkerLive } from "../runtime/WorkerLayers.ts"
import { work } from "../worker/work.ts"

loadDotEnv()

/** Polling interval while the queue is empty. */
const IDLE = "2 seconds"

work(IDLE).pipe(Effect.provide(WorkerLive), NodeRuntime.runMain)
