import { Cause, Predicate } from "effect"
import { inspect } from "node:util"

/** A thrown or failed value as one readable sentence: its message, or its tag when it has none. */
const describeError = (error: unknown): string => {
  if (Predicate.isString(error)) return error
  if (Predicate.hasProperty(error, "message") && Predicate.isString(error.message) && error.message.length > 0) {
    return error.message
  }
  if (Predicate.hasProperty(error, "_tag")) return String(error._tag)
  return inspect(error, { depth: 2, breakLength: Infinity })
}

/** Why an effect failed, without its stack: the console shows it in a line, not a trace. */
export const describeCause = (cause: Cause.Cause<unknown>): string =>
  Cause.hasInterruptsOnly(cause) ? "Stopped." : describeError(Cause.squash(cause))

/** A log line's parts as text: strings as they are, causes and errors by their message. */
export const describeParts = (parts: ReadonlyArray<unknown>): string =>
  parts
    .map((part) =>
      Predicate.isString(part)
        ? part
        : Cause.isCause(part)
          ? describeCause(part)
          : part instanceof Error
            ? part.message
            : inspect(part, { depth: 3, breakLength: 120 })
    )
    .join(" ")
