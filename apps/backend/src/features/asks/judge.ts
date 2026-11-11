import { type ClaudeError, CONTESTED_AT, type DraftCandidate, Lexicographer, type Triage } from "@kotori/ai"
import { AiUnavailable, type Language, RateLimited } from "@kotori/contracts"
import type { AskTriage, DraftEntry } from "@kotori/db"
import { katakanaToHiragana } from "@kotori/language"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { Dictionary } from "../dictionary/Dictionary.ts"
import { findForms } from "../dictionary/queries.ts"
import { checkDraft } from "./draft.ts"
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

/**
 * The one entry a draft would duplicate: an entry written as its headword or one of its spellings
 * (inflections aside) and, for Japanese, read as it is too, since 上手 read うわて isn't 上手 read
 * じょうず. English forms match case-folded, so a spelling that matches exactly wins ("polish" over
 * "Polish"). When that still leaves two or more, nothing says which the draft is: none is chosen,
 * and the draft waits for the admin like any other.
 */
const duplicateOf = Effect.fnUntraced(function* (db: DatabaseShape, draft: DraftEntry, language: Language) {
  const texts = [draft.headword, ...draft.spellings]
  const forms = (yield* findForms(db, texts, language)).filter((form) => form.kind !== "inflection")
  let ids = new Set(forms.map((form) => form.entryId))
  if (language === "en") {
    const exact = new Set(forms.filter((form) => texts.includes(form.text)).map((form) => form.entryId))
    if (exact.size > 0) ids = exact
  } else if (draft.reading.length > 0) {
    const readings = [...new Set([draft.reading, katakanaToHiragana(draft.reading)])]
    const read = new Set((yield* findForms(db, readings, language)).map((form) => form.entryId))
    ids = new Set([...ids].filter((id) => read.has(id)))
  }
  const [only, ...more] = ids
  return only !== undefined && more.length === 0 ? Option.some(only) : Option.none()
})

/**
 * Stage two of Ask Kotori: Claude's verdict on a query Jev took for a lookup (or couldn't sort),
 * checked against the dictionary so it can neither invent a link nor duplicate an entry. A link
 * must name one of the lookalikes Claude was shown, by number; one that doesn't is no link. A
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

  // Candidates are numbered from 1, in the order Claude saw them.
  const linked = output.verdict === "link" && output.link !== null ? found.entries[output.link - 1] : undefined
  if (linked !== undefined) return linkTo(linked.id)
  const draft = output.entry === null ? null : checkDraft(output.entry, language)
  if ((output.verdict === "entry" || output.verdict === "link") && draft !== null) {
    const duplicate = yield* duplicateOf(db, draft, language)
    if (Option.isSome(duplicate)) return linkTo(duplicate.value)
    return { ...base, status: "pending", draft, linkedEntryId: null, reason: null } satisfies Verdict
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
