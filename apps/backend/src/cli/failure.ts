import { Schema } from "effect"

/**
 * A command that finished but didn't do its job: a step was refused or left undone. The CLI prints
 * the message and exits 1, so a deploy or setup script stops; the admin console marks the run failed.
 */
export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  message: Schema.String
}) {}
