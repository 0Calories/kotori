import { type ClaudeError, CONTESTED_AT, type DraftCandidate, Lexicographer, type Triage } from "@kotori/ai"
import { AiUnavailable, type DraftEntry, type Language, RateLimited } from "@kotori/contracts"
import type { AskTriage } from "@kotori/db"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { Dictionary } from "../dictionary/Dictionary.ts"
import { findForms } from "../dictionary/queries.ts"
import type { Verdict } from "./queries.ts"

/** Jev's routing of a query: as stored with the proposal, and as read (`interpretTriage`). */
export interface Triaged {
  readonly record: AskTriage
  readonly reading: Triage
}

const fromClaude = (error: ClaudeError): AiUnavailable | RateLimited =>
  error.reason === "rate_limited"
    ? new RateLimited({ message: "Kotori is a little busy. Try again in a moment.", retryAfterSeconds: 30 })
    : new AiUnavailable({ message: "Kotori couldn't look into that right now. Please try again." })

/** The entry a headword names, spelled as written or case-folded, inflections aside. */
const resolve = Effect.fnUntraced(function* (db: DatabaseShape, texts: ReadonlyArray<string>, language: Language) {
  const matches = yield* findForms(db, texts, language)
  return Option.fromNullishOr(matches.find((match) => match.kind !== "inflection")?.entryId)
})

/**
 * Stage two of Ask Kotori: Claude's verdict on a query Jev took for a lookup (or couldn't sort),
 * checked against the dictionary so it can neither invent a link nor duplicate an entry. A
 * rejection without Claude's own reason leaves `reason` null for the app to word.
 */
export const judge = Effect.fn("asks.judge")(function* (
  db: DatabaseShape,
  query: string,
  language: Language,
  triaged: Triaged | null
) {
  const dictionary = yield* Dictionary
  const lexicographer = yield* Lexicographer
  const found = yield* dictionary.search(query, language, 10)
  const candidates: ReadonlyArray<DraftCandidate> = found.entries.map((entry) => ({
    headword: entry.headword,
    reading: entry.reading,
    meanings: entry.meanings
  }))
  const output = yield* lexicographer.draft({ query, language, candidates }).pipe(Effect.mapError(fromClaude))
  const base = { model: output.model, route: "lookup" as const, triage: triaged?.record ?? null, contested: false }
  const linkTo = (entryId: Verdict["linkedEntryId"]): Verdict => ({
    ...base,
    status: "linked",
    draft: null,
    linkedEntryId: entryId,
    reason: null
  })

  if (output.verdict === "link" && output.link !== null) {
    const linked = yield* resolve(db, [output.link], language)
    if (Option.isSome(linked)) return linkTo(linked.value)
  }
  const draft = output.entry
  if ((output.verdict === "entry" || output.verdict === "link") && draft !== null && draft.senses.length > 0) {
    const duplicate = yield* resolve(db, [draft.headword, ...draft.spellings], language)
    if (Option.isSome(duplicate)) return linkTo(duplicate.value)
    const spellings = draft.spellings.filter((spelling) => spelling !== draft.headword)
    return {
      ...base,
      status: "pending",
      draft: { ...draft, spellings } satisfies DraftEntry,
      linkedEntryId: null,
      reason: null
    } satisfies Verdict
  }
  return {
    ...base,
    status: "rejected",
    draft: null,
    linkedEntryId: null,
    reason: output.reason?.trim() || null,
    // Jev was sure this was a lookup and Claude turned it down: the admin should see it.
    contested: triaged !== null && triaged.reading.probabilities.lookup >= CONTESTED_AT
  } satisfies Verdict
})
