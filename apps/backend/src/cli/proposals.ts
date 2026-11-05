import type { Claude, Lexicographer } from "@kotori/ai"
import { proposalAsks, proposals } from "@kotori/db"
import { and, count, desc, eq } from "drizzle-orm"
import { Console, Effect, type Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import {
  APPROVED_EN_FILE,
  APPROVED_JA_FILE,
  approveProposal,
  discardProposal,
  redoProposal
} from "../features/asks/review.ts"
import type { Dictionary } from "../features/dictionary/Dictionary.ts"
import { resolveFromRoot } from "../runtime/Paths.ts"

const id = Argument.Int("id").pipe(Argument.withDescription("The proposal's id, from `kotori proposals list`"))

const files = { en: resolveFromRoot(APPROVED_EN_FILE), ja: resolveFromRoot(APPROVED_JA_FILE) }

const notFound = (id: number) => Console.error(`No proposal ${id}.`)
const notPending = (id: number, status: string) => Console.error(`Proposal ${id} is ${status}, not pending.`)

const list = Command.make(
  "list",
  {
    status: Flag.Literals("status", ["pending", "linked", "rejected", "approved", "discarded", "all"]).pipe(
      Flag.withDescription(
        "Which proposals to list: pending by default, rejected with --contested; rejected ones are worth a look for false negatives"
      ),
      Flag.optional
    ),
    contested: Flag.Boolean("contested").pipe(
      Flag.withDescription("Only rejections Claude made of queries Jev was sure were lookups"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ status: chosen, contested }) {
    // Contested proposals are all rejections, so asking for them alone means the rejected ones.
    const status = Option.getOrElse(chosen, () => (contested ? "rejected" : "pending"))
    const db = yield* Database
    const shown = yield* db
      .select({ proposal: proposals, asks: count(proposalAsks.userId) })
      .from(proposals)
      .leftJoin(proposalAsks, eq(proposalAsks.proposalId, proposals.id))
      .where(
        and(
          status === "all" ? undefined : eq(proposals.status, status),
          contested ? eq(proposals.contested, true) : undefined
        )
      )
      .groupBy(proposals.id)
      .orderBy(desc(proposals.createdAt))
      .limit(200)
      .pipe(Effect.orDie)
    if (shown.length === 0) {
      return yield* Console.log(status === "pending" && !contested ? "Nothing waiting." : "Nothing there.")
    }
    for (const { proposal, asks } of shown) {
      yield* Console.log(
        [
          String(proposal.id).padStart(5),
          proposal.language,
          proposal.status.padEnd(9),
          (proposal.route ?? "-").padEnd(14),
          // "!" marks a contested rejection: Jev said lookup, Claude said no. Many asks say the same.
          proposal.contested ? "!" : " ",
          `asks:${String(asks).padEnd(4)}`,
          proposal.createdAt.toISOString().slice(0, 10),
          proposal.query +
            (proposal.draft !== null && proposal.draft.headword !== proposal.query
              ? `  → ${proposal.draft.headword}`
              : "")
        ].join("  ")
      )
    }
  })
).pipe(Command.withDescription("List Ask Kotori proposals, newest first"))

const show = Command.make(
  "show",
  { id },
  Effect.fn(function* ({ id }) {
    const db = yield* Database
    const rows = yield* db.select().from(proposals).where(eq(proposals.id, id)).pipe(Effect.orDie)
    if (rows[0] === undefined) return yield* notFound(id)
    yield* Console.log(JSON.stringify(rows[0], null, 2))
  })
).pipe(Command.withDescription("Show one proposal in full, draft and all"))

const approve = Command.make(
  "approve",
  {
    id,
    aliasOf: Flag.String("alias-of").pipe(
      Flag.withDescription("Approve as another way the given headword is written, not a new entry"),
      Flag.optional
    ),
    headword: Flag.String("headword").pipe(Flag.withDescription("Override the draft's headword"), Flag.optional)
  },
  Effect.fn(function* ({ id, aliasOf, headword }) {
    const db = yield* Database
    yield* approveProposal(db, id, files, {
      aliasOf: Option.getOrUndefined(aliasOf),
      headword: Option.getOrUndefined(headword)
    }).pipe(
      Effect.flatMap((result) =>
        Console.log(
          result.alias === null
            ? `Approved: entry ${result.entryId} "${result.headword}", enrichment queued, saved to the approved file. Commit it.`
            : `Approved: "${result.alias}" now a form of entry ${result.entryId} "${result.headword}", saved to the approved file. Commit it.`
        )
      ),
      Effect.catchTag("NoSuchProposal", () => notFound(id)),
      Effect.catchTag("NotPending", (error) => notPending(id, error.status)),
      Effect.catchTag("NoSuchAlias", (error) => Console.error(`No entry is written "${error.text}".`))
    )
  })
).pipe(Command.withDescription("Turn a pending draft into a real entry (or an alias of one)"))

const discard = Command.make(
  "discard",
  {
    id,
    reason: Flag.String("reason").pipe(Flag.withDescription("Why, for the record"), Flag.optional)
  },
  Effect.fn(function* ({ id, reason }) {
    const db = yield* Database
    yield* discardProposal(db, id, Option.getOrNull(reason)).pipe(
      Effect.flatMap((result) => Console.log(`Discarded "${result.query}"; it won't be generated again.`)),
      Effect.catchTag("NoSuchProposal", () => notFound(id)),
      Effect.catchTag("NotPending", (error) => notPending(id, error.status))
    )
  })
).pipe(Command.withDescription("Turn a pending draft down, keeping the answer as a negative cache"))

const redo = Command.make(
  "redo",
  { id },
  Effect.fn(function* ({ id }) {
    const db = yield* Database
    yield* redoProposal(db, id).pipe(
      Effect.flatMap(({ proposal, linked }) =>
        Console.log(
          `Asked again: proposal ${id} is now ${proposal.status}` +
            (proposal.draft !== null ? ` with a draft for "${proposal.draft.headword}"` : "") +
            (linked !== null ? `, linked to "${linked}"` : "") +
            (proposal.reason !== null ? `: ${proposal.reason}` : "") +
            "."
        )
      ),
      Effect.catchTags({
        NoSuchProposal: () => notFound(id),
        NotRejected: (error) => Console.error(`Proposal ${id} is ${error.status}, not rejected.`),
        AiUnavailable: (error) => Console.error(error.message),
        RateLimited: (error) => Console.error(error.message)
      })
    )
  })
).pipe(
  Command.withDescription("Ask Claude again about a rejected proposal, replacing its answer (for a wrong rejection)")
)

/**
 * `kotori proposals`. The review commands need only the database; `redo` alone also needs the
 * dictionary and Claude, which the caller gives it so the others never build them.
 */
export const proposalsCommand = <E, R>(redoServices: Layer.Layer<Dictionary | Lexicographer | Claude, E, R>) =>
  Command.make("proposals").pipe(
    Command.withDescription("Review Ask Kotori's drafted entries: the manual gate before the dictionary"),
    Command.withSubcommands([list, show, approve, discard, redo.pipe(Command.provide(redoServices))])
  )
