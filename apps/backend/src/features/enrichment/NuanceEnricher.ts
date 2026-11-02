import {
  candidateOf,
  interpretSense,
  type JevError,
  judgedSenses,
  MAX_CANDIDATES,
  MAX_LOANS,
  NuanceJudge,
  reinterpretLoan,
  type SenseAnswers,
  senseTags,
  SIMILAR_SENSES
} from "@kotori/ai"
import type { EntryRecord } from "@kotori/contracts"
import type { EntryId } from "@kotori/db"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { Database } from "../../db/Database.ts"
import { findForms, getEntries, loanCandidates, sharedGlossCandidates, tagLabels } from "../dictionary/index.ts"
import {
  loanAnswersFor,
  nuanceAnswersFor,
  saveLoanWord,
  saveNuance,
  saveSimilar,
  updateLoanWord,
  updateNuance
} from "./queries.ts"

export class EntryNotFound extends Schema.TaggedError<EntryNotFound>()("EntryNotFound", { entryId: Schema.Int }) {}

export interface NuanceSummary {
  readonly senses: number
  readonly similar: number
  /** An English word's katakana loan, when Jev judged one of its candidates to be it. */
  readonly loan: string | null
  readonly inputTokens: number
}

/** Gathers what Jev is asked about an entry from the dictionary, has `NuanceJudge` judge it, and keeps the result. */
export class NuanceEnricher extends Context.Service<
  NuanceEnricher,
  {
    enrich(entryId: EntryId): Effect.Effect<NuanceSummary, JevError | EntryNotFound>
    /** Re-derives an entry's nuance and loan verdict from its stored answers and tags, without inference. */
    reinterpret(entryId: EntryId): Effect.Effect<{ readonly senses: number }, EntryNotFound>
  }
>()("@kotori/backend/NuanceEnricher") {
  static readonly layer = Layer.effect(
    NuanceEnricher,
    Effect.gen(function* () {
      const judge = yield* NuanceJudge
      const db = yield* Database

      /**
       * The dictionary's own cross-references first (JMDict's "see also", Wiktionary's synonyms),
       * then words in the same dictionary sharing an exact gloss.
       */
      const candidatesFor = Effect.fnUntraced(function* (entry: EntryRecord, senseIndex: number) {
        const sense = entry.senses[senseIndex]!
        const xrefTexts = sense.xrefs.map((xref) => xref.split("・")[0]!).filter((text) => text.length > 0)
        const xrefMatches = yield* findForms(db, xrefTexts, entry.language)
        const shared = yield* sharedGlossCandidates(db, entry.id, senseIndex, MAX_CANDIDATES)

        const ids = [...new Set([...xrefMatches.map((match) => match.entryId), ...shared.map((c) => c.entryId)])]
          .filter((id) => id !== entry.id)
          .slice(0, MAX_CANDIDATES)
        const entries = yield* getEntries(db, ids)

        return entries.map((candidate) =>
          candidateOf(candidate, shared.find((c) => c.entryId === candidate.id)?.sense ?? 0)
        )
      })

      /** An English word's katakana loan candidates from JMDict, most frequent first. */
      const loansFor = Effect.fnUntraced(function* (entry: EntryRecord) {
        if (entry.language !== "en") return []
        const found = yield* loanCandidates(db, [entry.headword], MAX_LOANS)
        const entries = new Map(
          (yield* getEntries(
            db,
            found.map((candidate) => candidate.entryId)
          )).map((e) => [e.id, e])
        )
        return found.flatMap((candidate) => {
          const loan = entries.get(candidate.entryId)
          return loan === undefined ? [] : [{ entry: loan, by: candidate.by }]
        })
      })

      const enrich = Effect.fn("NuanceEnricher.enrich")(function* (entryId: EntryId) {
        const [entry] = yield* getEntries(db, [entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const senses = judgedSenses(entry)
        if (senses.length === 0) return { senses: 0, similar: 0, loan: null, inputTokens: 0 }

        const judgment = yield* judge.judge({
          entry,
          tags: yield* tagLabels(db),
          candidates: yield* Effect.forEach(senses, (_, index) =>
            index < SIMILAR_SENSES ? candidatesFor(entry, index) : Effect.succeed([])
          ),
          loans: yield* loansFor(entry)
        })

        const now = new Date(yield* Clock.currentTimeMillis)
        const { model, questionsVersion, loan } = judgment
        yield* saveNuance(
          db,
          entryId,
          judgment.senses.map((sense) => ({ ...sense, model, questionsVersion })),
          now
        )
        yield* saveSimilar(db, entryId, judgment.similar)
        yield* saveLoanWord(
          db,
          entryId,
          loan === null
            ? null
            : { word: loan.word, verdict: loan.verdict, answers: loan.answers, model: loan.model, questionsVersion },
          now
        )
        return {
          senses: judgment.senses.length,
          similar: judgment.similar.length,
          loan: loan?.word ?? null,
          inputTokens: judgment.inputTokens
        }
      })

      const reinterpret = Effect.fn("NuanceEnricher.reinterpret")(function* (entryId: EntryId) {
        const [entry] = yield* getEntries(db, [entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const rows = yield* nuanceAnswersFor(db, entryId)
        yield* Effect.forEach(
          rows,
          (row) => {
            const sense = entry.senses[row.sense]
            return updateNuance(
              db,
              entryId,
              row.sense,
              interpretSense(row.answers as SenseAnswers, sense === undefined ? [] : senseTags(sense), sense?.fields)
            )
          },
          { discard: true }
        )
        const loanAnswers = yield* loanAnswersFor(db, entryId)
        if (Option.isSome(loanAnswers)) {
          const loan = reinterpretLoan(loanAnswers.value as Readonly<Record<string, unknown>>)
          yield* updateLoanWord(db, entryId, loan.word, loan.verdict)
        }
        return { senses: rows.length }
      })

      return NuanceEnricher.of({ enrich, reinterpret })
    })
  )
}
