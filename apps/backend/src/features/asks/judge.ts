import { type ClaudeError, CONTESTED_AT, type DraftCandidate, Lexicographer, type Triage } from "@kotori/ai"
import { AiUnavailable, type Language, RateLimited } from "@kotori/contracts"
import type { AskTriage, DraftEntry, EntryId } from "@kotori/db"
import { katakanaToHiragana } from "@kotori/language"
import { Effect, Match, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { Dictionary } from "../dictionary/Dictionary.ts"
import { entryRanks, findForms } from "../dictionary/queries.ts"
import { checkDraft } from "./draft.ts"
import type { DraftedEntryState, Verdict } from "./queries.ts"

export interface Triaged {
  readonly record: AskTriage
  readonly reading: Triage
}

const fromClaude = (error: ClaudeError): AiUnavailable | RateLimited =>
  error.reason === "rate_limited"
    ? new RateLimited({ message: "Kotori is a little busy. Try again in a moment.", retryAfterSeconds: 30 })
    : new AiUnavailable({ message: "Kotori couldn't look into that right now. Please try again." })

const duplicateOf = Effect.fnUntraced(function* (db: DatabaseShape, draft: DraftEntry, language: Language) {
  const texts = [draft.headword, ...draft.spellings]
  const forms = (yield* findForms(db, texts, language, "searchable")).filter((form) => form.kind !== "inflection")
  let ids = new Set(forms.map((form) => form.entryId))
  if (language === "en") {
    const exact = new Set(forms.filter((form) => texts.includes(form.text)).map((form) => form.entryId))
    if (exact.size > 0) ids = exact
  } else if (draft.reading.length > 0) {
    // Japanese homographs (e.g. 上手 read じょうず vs うわて) are distinct entries unless they share a reading.
    const readings = [...new Set([draft.reading, katakanaToHiragana(draft.reading)])]
    const read = new Set((yield* findForms(db, readings, language, "searchable")).map((form) => form.entryId))
    ids = new Set([...ids].filter((id) => read.has(id)))
  }
  const [only, ...more] = ids
  return only !== undefined && more.length === 0 ? Option.some(only) : Option.none()
})

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
  const answerWith = Effect.fnUntraced(function* (entryId: EntryId) {
    const entry: DraftedEntryState = (yield* entryRanks(db, [entryId])).get(entryId)?.review ?? "gone"
    return {
      ...base,
      status: Match.value(entry).pipe(
        Match.when("approved", () => "linked" as const),
        Match.whenOr("unreviewed", "discarded", () => "drafted" as const),
        // Deleted since search ran; avoid reporting an existing entry as a removed draft.
        Match.when("gone", () => "linked" as const),
        Match.exhaustive
      ),
      draft: null,
      entryId,
      reason: null
    } satisfies Verdict
  })

  const linked = output.verdict === "link" && output.link !== null ? found.entries[output.link - 1] : undefined
  if (linked !== undefined) return yield* answerWith(linked.id)
  const draft = output.entry === null ? null : checkDraft(output.entry, language)
  if ((output.verdict === "entry" || output.verdict === "link") && draft !== null) {
    const duplicate = yield* duplicateOf(db, draft, language)
    if (Option.isSome(duplicate)) return yield* answerWith(duplicate.value)
    return { ...base, status: "drafted", draft, entryId: null, reason: null } satisfies Verdict
  }
  return {
    ...base,
    status: "rejected",
    draft: null,
    entryId: null,
    reason: output.reason?.trim() || null,
    contested: triaged !== null && triaged.reading.probabilities.lookup >= CONTESTED_AT
  } satisfies Verdict
})
