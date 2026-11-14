import { Claude, interpretTriage, Jev, JevDeadline, Lexicographer, TRIAGE_VERSION, triageRequest } from "@kotori/ai"
import {
  AiUnavailable,
  AskRefused,
  type Language,
  type Profile,
  type Proposal,
  ProposalId,
  RateLimited
} from "@kotori/contracts"
import { normalizeAsk } from "@kotori/language"
import { Clock, Config, Context, Effect, Layer, Match, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { scopedToUser } from "../../db/scopedToUser.ts"
import { reserveUsage } from "../coaching/queries.ts"
import { Dictionary } from "../dictionary/Dictionary.ts"
import { deleteEntries } from "../dictionary/index.ts"
import { entryRanks } from "../dictionary/queries.ts"
import { unique } from "../dictionary/shared.ts"
import { draftedEntryView, writeDraftedEntry } from "./draft.ts"
import { turnAway } from "./garbage.ts"
import { judge, type Triaged } from "./judge.ts"
import {
  asksFor,
  findProposal,
  insertProposal,
  type ProposalRow,
  recordAsk,
  standing,
  type Verdict
} from "./queries.ts"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * "Ask Kotori": answers a search the dictionary couldn't, in three stages that get dearer as
 * they go. Deterministic checks turn mash and the wrong language away for free (`turnAway`);
 * Jev sorts the rest by what kind of input it is (`AskRoute`), and only lookups reach Claude,
 * which drafts an entry, names the existing entry the learner missed, or says the query isn't a
 * real expression (`judge`). A hesitant Jev fails open to Claude: a real question must never be
 * lost to the cheap stage. Answers are kept per normalized query, so a question is only ever
 * paid for once. A draft is an unreviewed dictionary entry from the start (ADR 0002), shown marked
 * unverified and saveable to notes, until the admin (`kotori proposals`) approves or discards it.
 * Each learner has their own allowances, Jev's and Claude's apart, so no one learner can use up
 * Ask Kotori for everyone.
 */
export class Asks extends Context.Service<
  Asks,
  {
    ask(user: Profile, query: string): Effect.Effect<Proposal, AskRefused | AiUnavailable | RateLimited>
    /** The learner's own asks, newest first. */
    asks(user: Profile): Effect.Effect<ReadonlyArray<Proposal>>
  }
>()("@kotori/backend/Asks") {
  static readonly layer = Layer.effect(
    Asks,
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const claude = yield* Claude
      const jev = yield* Jev
      const judging = yield* Effect.context<Dictionary | Lexicographer>()
      const askHourly = yield* Config.Int("KOTORI_ASK_HOURLY_LIMIT").pipe(Config.withDefault(10))
      const askDaily = yield* Config.Int("KOTORI_ASK_DAILY_LIMIT").pipe(Config.withDefault(30))
      const triageHourly = yield* Config.Int("KOTORI_TRIAGE_HOURLY_LIMIT").pipe(Config.withDefault(60))

      /** Proposals as the app reads them, each standing where its entry does. */
      const toProposals = Effect.fnUntraced(function* (rows: ReadonlyArray<ProposalRow>) {
        const ids = unique(rows.flatMap((row) => (row.entryId === null ? [] : [row.entryId])))
        const reviews = yield* entryRanks(db, ids)
        const summaries = new Map(
          (ids.length === 0 ? [] : yield* dictionary.summarize(ids)).map((entry) => [entry.id, entry])
        )
        return yield* Effect.forEach(
          rows,
          Effect.fnUntraced(function* (row) {
            const status = standing(
              row.status,
              row.entryId === null ? "gone" : (reviews.get(row.entryId)?.review ?? "gone")
            )
            // What the answer shows of its entry: the draft itself, the entry as a link, or nothing.
            const shows = Match.value(status).pipe(
              Match.when("pending", () => "draft" as const),
              Match.whenOr("linked", "approved", () => "link" as const),
              Match.whenOr("rejected", "discarded", "removed", () => "nothing" as const),
              Match.exhaustive
            )
            const draft =
              shows === "draft" && row.entryId !== null
                ? Option.getOrNull(Option.map(yield* dictionary.entry(row.entryId), draftedEntryView))
                : null
            return {
              id: ProposalId.make(row.id),
              query: row.query,
              language: row.language,
              status,
              draft,
              linked: shows === "link" && row.entryId !== null ? (summaries.get(row.entryId) ?? null) : null,
              reason: row.reason,
              route: row.route
            } satisfies Proposal
          })
        )
      })
      const toProposal = (row: ProposalRow) => toProposals([row]).pipe(Effect.map((proposals) => proposals[0]!))

      /**
       * Takes one of the learner's requests of `kind` (`ask`: Claude, per hour and per day;
       * `triage`: Jev, per hour), or fails when they've used them up.
       */
      const reserve = Effect.fnUntraced(function* (user: Profile, kind: "ask" | "triage", now: Date) {
        const hour = { since: new Date(now.getTime() - HOUR), limit: kind === "ask" ? askHourly : triageHourly }
        const day = { since: new Date(now.getTime() - DAY), limit: askDaily }
        const full = yield* reserveUsage(scopedToUser(db, user.id), {
          kind,
          kinds: [kind],
          windows: kind === "ask" ? [hour, day] : [hour],
          now
        })
        if (Option.isNone(full)) return
        return yield* full.value === day
          ? new RateLimited({ message: "You've asked a lot today. Try again tomorrow!", retryAfterSeconds: 3600 })
          : new RateLimited({ message: "You've asked a lot this hour. Take a breather!", retryAfterSeconds: 600 })
      })

      /**
       * Stage one: Jev's reading of the query, or none when Jev isn't configured or failed — in
       * which case the query goes on to Claude as if it were a lookup.
       */
      const triage = Effect.fnUntraced(function* (query: string, language: Language) {
        if (!jev.configured) return null
        const request = triageRequest(query, language)
        const answers = yield* jev.ask(request.state, request.questions, { timeout: JevDeadline.interactive }).pipe(
          Effect.map((result) => result.answers as Readonly<Record<string, unknown>>),
          Effect.catchTag("JevError", (error) =>
            Effect.logWarning(`Ask triage failed; asking Claude instead: ${error.message}`).pipe(Effect.as(null))
          )
        )
        if (answers === null) return null
        return {
          record: { answers, model: jev.model, version: TRIAGE_VERSION },
          reading: interpretTriage(answers)
        } satisfies Triaged
      })

      const ask = Effect.fn("Asks.ask")(function* (user: Profile, raw: string) {
        const language = user.targetLanguage
        const query = normalizeAsk(raw, language)

        // Stage zero: free, and never stored, but logged, so its mistakes show.
        const refusal = turnAway(query, language)
        if (refusal !== null) {
          yield* Effect.logInfo(`Ask Kotori turned away ${language} ${JSON.stringify(query)}: ${refusal}`)
          return yield* new AskRefused({ reason: refusal })
        }

        // One question, one answer: whoever asked first paid; everyone who asks reads it.
        const existing = yield* findProposal(db, language, query)
        const now = new Date(yield* Clock.currentTimeMillis)
        if (Option.isSome(existing)) {
          yield* recordAsk(db, existing.value.id, user.id, now)
          return yield* toProposal(existing.value)
        }

        // Never trust the client that nothing matched; strong results mean there is nothing to ask.
        const found = yield* dictionary.search(query, language, 10)
        if (found.match === "exact") return yield* new AskRefused({ reason: "in_dictionary" })

        // Stage one, on its own allowance: a Jev call costs a fraction of a Claude one.
        if (jev.configured) yield* reserve(user, "triage", now)
        const triaged = yield* triage(query, language)
        const route = triaged?.reading.route ?? "lookup"

        const settle = Effect.fnUntraced(function* ({ draft, ...verdict }: Verdict) {
          // A new draft is an entry before the proposal names it.
          const drafted = draft === null ? null : yield* writeDraftedEntry(db, draft, language)
          const entryId = drafted ?? verdict.entryId
          const row = yield* insertProposal(db, { language, query, ...verdict, entryId, requestedBy: user.id, now })
          // Another learner asked the same at the same moment and their answer stands: ours goes.
          if (drafted !== null && row.entryId !== drafted) yield* deleteEntries(db, [drafted])
          yield* recordAsk(db, row.id, user.id, now)
          return yield* toProposal(row)
        })

        if (route !== "lookup") {
          // Not a lookup: the answer is the route itself, which the app turns into a pointer.
          return yield* settle({
            status: "rejected",
            draft: null,
            entryId: null,
            reason: null,
            model: jev.model,
            route,
            triage: triaged?.record ?? null,
            contested: false
          })
        }

        // Stage two.
        if (!(yield* claude.available)) {
          return yield* new AiUnavailable({ message: "Ask Kotori isn't available on this server right now." })
        }
        yield* reserve(user, "ask", now)
        return yield* settle(yield* judge(db, query, language, triaged).pipe(Effect.provideContext(judging)))
      })

      const asks = Effect.fn("Asks.asks")(function* (user: Profile) {
        return yield* toProposals(yield* asksFor(db, user.id))
      })

      return Asks.of({ ask, asks })
    })
  )
}
