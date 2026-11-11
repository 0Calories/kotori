import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { Cause, Console, Effect, Exit, Fiber, Layer, type LogLevel, Logger, ManagedRuntime } from "effect"
import { Command } from "effect/cli"
import { format } from "node:util"
import { kotori, VERSION } from "../cli/kotori.ts"
import { DatabaseLive } from "../db/Database.ts"
import { AccountsLive, RedoLive } from "../runtime/CliLayers.ts"
import { loggerLayer, SentryLive } from "../runtime/Sentry.ts"
import { WorkerLive } from "../runtime/WorkerLayers.ts"
import { describeCause, describeParts } from "./model/describe.ts"
import { Notices } from "./model/notices.ts"
import { type LineLevel, TaskStore } from "./model/tasks.ts"

type Write = (level: LineLevel, text: string) => void

const levelOf = (level: LogLevel.LogLevel): LineLevel => {
  switch (level) {
    case "Fatal":
    case "Error":
      return "error"
    case "Warn":
      return "warn"
    case "Info":
      return "info"
    default:
      return "debug"
  }
}

/** Effect logs as lines: the message's parts, then the cause they were logged with. */
const linesLogger = (write: Write) =>
  Logger.make<unknown, void>(({ message, logLevel, cause }) => {
    const parts = Array.isArray(message) ? message : [message]
    const withCause = Cause.hasFails(cause) || Cause.hasDies(cause) ? [...parts, cause] : parts
    write(levelOf(logLevel), describeParts(withCause))
  })

/**
 * A `Console` that writes into a run's log instead of the terminal, which the console's screen
 * owns. Formatting follows Node's console, so a command prints here as it prints in a shell.
 */
export const captureConsole = (write: Write): Console.Console => {
  let depth = 0
  const counts = new Map<string, number>()
  const timers = new Map<string, number>()
  const line = (level: LineLevel, args: ReadonlyArray<unknown>) =>
    write(
      level,
      format(...args)
        .split("\n")
        .map((text) => "  ".repeat(depth) + text)
        .join("\n")
    )
  const elapsed = (label: string) => `${label}: ${Date.now() - (timers.get(label) ?? Date.now())}ms`
  return {
    assert: (condition, ...args) => (condition ? undefined : line("error", ["Assertion failed:", ...args])),
    clear: () => undefined,
    count: (label = "default") => {
      const n = (counts.get(label) ?? 0) + 1
      counts.set(label, n)
      line("out", [`${label}: ${n}`])
    },
    countReset: (label = "default") => void counts.delete(label),
    debug: (...args) => line("debug", args),
    dir: (item) => line("out", [item]),
    dirxml: (...args) => line("out", args),
    error: (...args) => line("error", args),
    group: (...args) => {
      if (args.length > 0) line("out", args)
      depth++
    },
    groupCollapsed: (...args) => {
      if (args.length > 0) line("out", args)
      depth++
    },
    groupEnd: () => void (depth = Math.max(0, depth - 1)),
    info: (...args) => line("out", args),
    log: (...args) => line("out", args),
    table: (data) => line("out", [data]),
    time: (label = "default") => void timers.set(label, Date.now()),
    timeEnd: (label = "default") => {
      line("out", [elapsed(label)])
      timers.delete(label)
    },
    timeLog: (label = "default", ...args) => line("out", [elapsed(label), ...args]),
    trace: (...args) => line("debug", args),
    warn: (...args) => line("warn", args)
  }
}

/**
 * Services built on first use and kept for the session, so a view's second query reuses the
 * first one's connections. A build that fails (a missing variable, a database that's down) isn't
 * kept, so the next use tries again.
 */
class ServiceGroup<R, ER> {
  private runtime: ManagedRuntime.ManagedRuntime<R, ER> | undefined

  constructor(
    private readonly layer: Layer.Layer<R, ER>,
    private readonly memoMap: Layer.MemoMap
  ) {}

  async run<A, E>(effect: Effect.Effect<A, E, R>): Promise<Exit.Exit<A, E | ER>> {
    const runtime = (this.runtime ??= ManagedRuntime.make(this.layer, { memoMap: this.memoMap }))
    const built = await Effect.runPromiseExit(runtime.contextEffect)
    if (Exit.isFailure(built)) {
      if (this.runtime === runtime) this.runtime = undefined
      void runtime.dispose()
      return Exit.failCause(built.cause)
    }
    return runtime.runPromiseExit(effect)
  }

  async dispose() {
    const runtime = this.runtime
    this.runtime = undefined
    await runtime?.dispose()
  }
}

/**
 * Everything the console runs Effect code with: the views' services, and jobs, which are `kotori`
 * commands run from argv exactly as the CLI runs them, with what they print kept per run.
 */
export const makeConsoleRuntime = () => {
  const memoMap = Layer.makeMemoMapUnsafe()
  /** Warnings and errors the views' services log, for the screen to show. */
  const notices = new Notices()
  // One reference, so every runtime sharing the memo map initialises Sentry once.
  const sentry = SentryLive("console")
  // The views' services log through Sentry and into the notices; nothing goes to the terminal.
  const logs = loggerLayer([
    linesLogger((level, text) => {
      if (level === "warn" || level === "error") notices.emit({ level, text })
    })
  ])
  const files = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
  const group = <R, ER>(layer: Layer.Layer<R, ER>) =>
    new ServiceGroup(Layer.mergeAll(layer, files, sentry, logs), memoMap)

  const services = {
    /** The database, and the files approvals write to. */
    database: group(DatabaseLive),
    /** Sign-ups and accounts: the auth store, mail and the learner table. */
    accounts: group(AccountsLive),
    /** Asking Claude again about a rejected proposal. */
    redo: group(Layer.provideMerge(RedoLive, DatabaseLive)),
    /** Coverage, which needs to know the configured providers. */
    worker: group(WorkerLive)
  }

  const tasks = new TaskStore()
  const jobs = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, sentry), { memoMap })
  const running = new Map<number, Fiber.Fiber<unknown, unknown>>()

  /** Starts `kotori <argv>` as a job and returns its run's id; what it prints goes to the run's log. */
  const runJob = (argv: ReadonlyArray<string>) => {
    const id = tasks.start(argv)
    const write: Write = (level, text) => tasks.append(id, level, text)
    const program = Command.runWith(kotori, { version: VERSION })(argv).pipe(
      Effect.provideService(Console.Console, captureConsole(write)),
      Effect.provide(loggerLayer([linesLogger(write)]))
    )
    const fiber = jobs.runFork(program)
    running.set(id, fiber)
    fiber.addObserver((exit) => {
      running.delete(id)
      if (Exit.isSuccess(exit)) return tasks.finish(id, "succeeded")
      if (Cause.hasInterruptsOnly(exit.cause)) return tasks.finish(id, "cancelled")
      const failure = describeCause(exit.cause)
      write("error", failure)
      tasks.finish(id, "failed", failure)
    })
    return id
  }

  /** Interrupts a running job; its scope closes, so connections and transactions are released. */
  const cancelJob = (id: number) => {
    const fiber = running.get(id)
    if (fiber !== undefined) void Effect.runPromise(Fiber.interrupt(fiber))
  }

  const dispose = async () => {
    await Promise.all([...running.values()].map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))))
    await Promise.all([...Object.values(services).map((service) => service.dispose()), jobs.dispose()])
  }

  return { services, tasks, notices, runJob, cancelJob, runningJobs: () => running.size, dispose }
}

export type ConsoleRuntime = ReturnType<typeof makeConsoleRuntime>
