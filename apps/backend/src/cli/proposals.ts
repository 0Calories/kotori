import type { Claude, Lexicographer } from "@kotori/ai"
import { entries, EntryId, proposalAsks, proposals } from "@kotori/db"
import { and, count, desc, eq, sql } from "drizzle-orm"
import { Console, Effect, type Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import { approveProposal, discardProposal, mergeProposal, redoProposal } from "../features/asks/review.ts"
import type { Dictionary } from "../features/dictionary/Dictionary.ts"

const id = Argument.Int("id").pipe(Argument.withDescription("The proposal's id, from `kotori proposals list`"))

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
      .select({
        proposal: proposals,
        asks: count(proposalAsks.userId),
        headword: sql<string | null>`${entries.base}->>'headword'`
      })
      .from(proposals)
      .leftJoin(proposalAsks, eq(proposalAsks.proposalId, proposals.id))
      .leftJoin(entries, eq(entries.id, proposals.linkedEntryId))
      .where(
        and(
          status === "all" ? undefined : eq(proposals.status, status),
          contested ? eq(proposals.contested, true) : undefined
        )
      )
      .groupBy(proposals.id, entries.id)
      .orderBy(desc(proposals.createdAt))
      .limit(200)
      .pipe(Effect.orDie)
    if (shown.length === 0) {
      return yield* Console.log(status === "pending" && !contested ? "Nothing waiting." : "Nothing there.")
    }
    for (const { proposal, asks, headword } of shown) {
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
            (headword !== null && headword !== proposal.query ? `  → ${headword}` : "") +
            (proposal.linkedEntryId !== null ? `  [${proposal.linkedEntryId}]` : "")
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
    const entry =
      rows[0].linkedEntryId === null
        ? null
        : ((yield* db.select().from(entries).where(eq(entries.id, rows[0].linkedEntryId)).pipe(Effect.orDie))[0] ??
          null)
    yield* Console.log(JSON.stringify({ proposal: rows[0], entry }, null, 2))
  })
).pipe(Command.withDescription("Show one proposal and its linked entry in full"))

const approve = Command.make(
  "approve",
  {
    id,
    headword: Flag.String("headword").pipe(Flag.withDescription("Override the draft's headword"), Flag.optional)
  },
  Effect.fn(function* ({ id, headword }) {
    const db = yield* Database
    yield* approveProposal(db, id, { headword: Option.getOrUndefined(headword) }).pipe(
      Effect.flatMap((result) => Console.log(`Approved in place: entry ${result.entryId} "${result.headword}".`)),
      Effect.catchTags({
        NoSuchProposal: () => notFound(id),
        NotPending: (error) => notPending(id, error.status),
        NoSuchEntry: (error) => Console.error(`No entry ${error.entryId}.`),
        InvalidReviewTransition: (error) =>
          Console.error(`Entry ${error.entryId} is ${error.from} and cannot be approved.`)
      })
    )
  })
).pipe(Command.withDescription("Promote an unreviewed Drafted entry to approved in place without changing its ID"))

const discard = Command.make(
  "discard",
  {
    id,
    reason: Flag.String("reason").pipe(Flag.withDescription("Why, for the record"), Flag.optional)
  },
  Effect.fn(function* ({ id, reason }) {
    const db = yield* Database
    yield* discardProposal(db, id, Option.getOrNull(reason)).pipe(
      Effect.flatMap((result) =>
        Console.log(`Discarded "${result.query}" (${result.entryId}); hidden from search and kept as a negative cache.`)
      ),
      Effect.catchTags({
        NoSuchProposal: () => notFound(id),
        NotPending: (error) => notPending(id, error.status),
        NoSuchEntry: (error) => Console.error(`No entry ${error.entryId}.`),
        InvalidReviewTransition: (error) =>
          Console.error(`Entry ${error.entryId} is ${error.from} and cannot be discarded.`)
      })
    )
  })
).pipe(Command.withDescription("Discard an unreviewed Drafted entry, hiding it from search as a negative cache"))

const merge = Command.make(
  "merge",
  {
    id,
    into: Flag.String("into").pipe(Flag.withDescription("Canonical EntryId to redirect the duplicate draft into"))
  },
  Effect.fn(function* ({ id, into }) {
    const db = yield* Database
    yield* mergeProposal(db, id, EntryId.make(into)).pipe(
      Effect.flatMap((result) =>
        Console.log(`Merged ${result.entryId} → ${result.targetEntryId} ("${result.headword}").`)
      ),
      Effect.catchTags({
        NoSuchProposal: () => notFound(id),
        NotPending: (error) => notPending(id, error.status),
        NoSuchEntry: (error) => Console.error(`No entry ${error.entryId}.`),
        InvalidReviewTransition: (error) =>
          Console.error(`Entry ${error.entryId} is ${error.from} and cannot be merged.`),
        InvalidMergeTarget: (error) => Console.error(`Invalid merge target ${error.targetEntryId}: ${error.reason}.`)
      })
    )
  })
).pipe(Command.withDescription("Merge a duplicate Drafted entry into a canonical Entry via redirect_to"))

const redo = Command.make(
  "redo",
  { id },
  Effect.fn(function* ({ id }) {
    const db = yield* Database
    yield* redoProposal(db, id).pipe(
      Effect.flatMap(({ proposal, linked }) =>
        Console.log(
          `Asked again: proposal ${id} is now ${proposal.status}` +
            (linked !== null ? `, linked to "${linked}" (${proposal.linkedEntryId})` : "") +
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
    Command.withDescription("Review Ask Kotori's drafted entries: approve in place, discard, or merge into canonical"),
    Command.withSubcommands([list, show, approve, discard, merge, redo.pipe(Command.provide(redoServices))])
  )
