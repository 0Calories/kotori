import { Claude, type ClaudeError, type DraftCandidate, Lexicographer } from "@kotori/ai"
import {
  AiUnavailable,
  type DraftEntry,
  InvalidRequest,
  type Language,
  type Profile,
  type Proposal,
  ProposalId,
  RateLimited
} from "@kotori/contracts"
import { EntryId } from "@kotori/db"
import { hasJapanese } from "@kotori/language"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { scopedToUser } from "../../db/scopedToUser.ts"
import { reserveUsage } from "../coaching/queries.ts"
import { Dictionary } from "../dictionary/Dictionary.ts"
import { findForms } from "../dictionary/queries.ts"
import { asksFor, findProposal, insertProposal, type ProposalRow, proposalsSince, recordAsk } from "./queries.ts"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** English queries are asked and cached lowercase; a word and its capitalisation are one question. */
export const normalizeAsk = (query: string, language: Language) => {
  const clean = query.normalize("NFKC").replace(/\s+/g, " ").trim()
  return language === "en" ? clean.toLowerCase() : clean
}

const MAX_WORDS = 8

/**
 * Whether a query is worth asking Claude about at all: short, in a plausible script, and not
 * markup or numbers. Looser than the dictionary's own notions on purpose — new slang is the
 * point — while keeping URLs, code and keyboard mash out of the spend.
 */
export const askable = (query: string, language: Language): boolean => {
  if (query.length < 2 || query.length > 64) return false
  if (query.split(" ").length > MAX_WORDS) return false
  if (!/\p{L}/u.test(query) || /[<>{}\\@#$%^*=_|~;:]|https?:|\/\//.test(query)) return false
  // A Japanese word may be asked in kana, kanji or rōmaji; an English one in English letters.
  return language === "ja"
    ? hasJapanese(query) || /^[a-z0-9' -]+$/i.test(query)
    : /^[a-z0-9' .&/-]+$/i.test(query) && !hasJapanese(query)
}

const fromClaude = (error: ClaudeError): AiUnavailable | RateLimited =>
  error.reason === "rate_limited"
    ? new RateLimited({ message: "Kotori is a little busy. Try again in a moment.", retryAfterSeconds: 30 })
    : new AiUnavailable({ message: "Kotori couldn't look into that right now. Please try again." })

/**
 * "Ask Kotori": answers a search the dictionary couldn't, with Claude drafting an entry, naming
 * the existing entry the learner missed, or saying the query isn't a real expression. Answers
 * are kept per normalized query, so a question is only ever paid for once, and drafts wait for
 * the admin (`kotori proposals`) before becoming real entries.
 */
export class Asks extends Context.Service<
  Asks,
  {
    ask(user: Profile, query: string): Effect.Effect<Proposal, InvalidRequest | AiUnavailable | RateLimited>
    /** The learner's own asks, newest first. */
    asks(user: Profile): Effect.Effect<ReadonlyArray<Proposal>>
  }
>()("@kotori/backend/Asks") {
  static readonly layer = Layer.effect(
    Asks,
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const lexicographer = yield* Lexicographer
      const claude = yield* Claude
      const hourlyLimit = yield* Config.Int("KOTORI_ASK_HOURLY_LIMIT").pipe(Config.withDefault(10))
      const dailyLimit = yield* Config.Int("KOTORI_ASK_DAILY_LIMIT").pipe(Config.withDefault(200))

      const toProposal = Effect.fnUntraced(function* (row: ProposalRow) {
        const linked =
          row.linkedEntryId === null ? null : ((yield* dictionary.summarize([row.linkedEntryId]))[0] ?? null)
        return {
          id: ProposalId.make(row.id),
          query: row.query,
          language: row.language,
          status: row.status,
          draft: row.draft,
          linked,
          reason: row.reason
        } satisfies Proposal
      })

      /** The entry a headword names, spelled as written or case-folded, inflections aside. */
      const resolve = Effect.fnUntraced(function* (texts: ReadonlyArray<string>, language: Language) {
        const matches = yield* findForms(db, texts, language)
        return Option.fromNullishOr(matches.find((match) => match.kind !== "inflection")?.entryId)
      })

      const ask = Effect.fn("Asks.ask")(function* (user: Profile, raw: string) {
        const language = user.targetLanguage
        const query = normalizeAsk(raw, language)
        if (!askable(query, language)) {
          return yield* new InvalidRequest({ message: "That doesn't look like something Kotori can look up." })
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
        if (found.match === "exact") {
          return yield* new InvalidRequest({ message: "The dictionary already has this one — it's in the results." })
        }
        if (!(yield* claude.available)) {
          return yield* new AiUnavailable({ message: "Ask Kotori isn't available on this server right now." })
        }
        if ((yield* proposalsSince(db, new Date(now.getTime() - DAY))) >= dailyLimit) {
          return yield* new RateLimited({
            message: "Kotori has answered a lot of questions today. Try again tomorrow!",
            retryAfterSeconds: 3600
          })
        }
        const reserved = yield* reserveUsage(scopedToUser(db, user.id), {
          kind: "ask",
          kinds: ["ask"],
          since: new Date(now.getTime() - HOUR),
          limit: hourlyLimit,
          now
        })
        if (!reserved) {
          return yield* new RateLimited({
            message: "You've asked a lot this hour. Take a breather!",
            retryAfterSeconds: 600
          })
        }

        const candidates: ReadonlyArray<DraftCandidate> = found.entries.map((entry) => ({
          headword: entry.headword,
          reading: entry.reading,
          meanings: entry.meanings
        }))
        const output = yield* lexicographer.draft({ query, language, candidates }).pipe(Effect.mapError(fromClaude))

        // Claude's word alone never creates an entry, and never duplicates one: a link must name
        // an entry that exists, and a draft whose headword already exists becomes a link to it.
        const judged = yield* Effect.gen(function* () {
          if (output.verdict === "link" && output.link !== null) {
            const linked = yield* resolve([output.link], language)
            if (Option.isSome(linked)) {
              return { status: "linked" as const, draft: null, linkedEntryId: linked.value, reason: null }
            }
          }
          const draft = output.entry
          if ((output.verdict === "entry" || output.verdict === "link") && draft !== null && draft.senses.length > 0) {
            const duplicate = yield* resolve([draft.headword, ...draft.spellings], language)
            if (Option.isSome(duplicate)) {
              return { status: "linked" as const, draft: null, linkedEntryId: duplicate.value, reason: null }
            }
            const spellings = draft.spellings.filter((spelling) => spelling !== draft.headword)
            return {
              status: "pending" as const,
              draft: { ...draft, spellings } satisfies DraftEntry,
              linkedEntryId: null,
              reason: null
            }
          }
          return {
            status: "rejected" as const,
            draft: null,
            linkedEntryId: null,
            reason:
              output.reason ??
              (user.nativeLanguage === "ja"
                ? "この表現は確認できませんでした。"
                : "Kotori couldn't verify this as a real expression.")
          }
        })

        const row = yield* insertProposal(db, {
          language,
          query,
          ...judged,
          linkedEntryId: judged.linkedEntryId === null ? null : EntryId.make(judged.linkedEntryId),
          model: output.model,
          requestedBy: user.id,
          now
        })
        yield* recordAsk(db, row.id, user.id, now)
        return yield* toProposal(row)
      })

      const asks = Effect.fn("Asks.asks")(function* (user: Profile) {
        return yield* Effect.forEach(yield* asksFor(db, user.id), toProposal)
      })

      return Asks.of({ ask, asks })
    })
  )
}
