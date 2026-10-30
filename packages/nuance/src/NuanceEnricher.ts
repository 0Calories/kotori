import { DictionaryRepo, EnrichmentRepo, type EntryRecord } from "@kotori/db"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { answersOfLoans, MAX_LOANS } from "./english.ts"
import {
  type AskedLoan,
  interpretCandidates,
  interpretLoan,
  interpretSense,
  type SenseAnswers,
  senseTags
} from "./interpret.ts"
import { Jev, type JevError } from "./Jev.ts"
import { answersOfSense, entryRequest, loanRequest, questionsVersionOf } from "./request.ts"
import { candidateOf, judgedSenses, MAX_CANDIDATES, SIMILAR_SENSES } from "./state.ts"

export class EntryNotFound extends Schema.TaggedError<EntryNotFound>()("EntryNotFound", { entryId: Schema.Int }) {}

export interface NuanceSummary {
  readonly senses: number
  readonly similar: number
  /** An English word's katakana loan, when Jev judged one of its candidates to be it. */
  readonly loan: string | null
  readonly inputTokens: number
}

/** The katakana words asked about, kept with the loan answers so the verdict can be re-derived. */
const StoredLoans = Schema.Struct({
  candidates: Schema.Array(Schema.Struct({ word: Schema.String, by: Schema.Literals(["gloss", "source"]) }))
})

export class NuanceEnricher extends Context.Service<
  NuanceEnricher,
  {
    readonly model: string
    enrich(entryId: number): Effect.Effect<NuanceSummary, JevError | EntryNotFound>
    /** Re-derives an entry's nuance and loan verdict from its stored answers and tags, without inference. */
    reinterpret(entryId: number): Effect.Effect<{ readonly senses: number }, EntryNotFound>
  }
>()("@kotori/nuance/NuanceEnricher") {
  static readonly layer = Layer.effect(
    NuanceEnricher,
    Effect.gen(function* () {
      const jev = yield* Jev
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo

      /**
       * The dictionary's own cross-references first (JMDict's "see also", Wiktionary's synonyms),
       * then words in the same dictionary sharing an exact gloss.
       */
      const candidatesFor = Effect.fnUntraced(function* (entry: EntryRecord, senseIndex: number) {
        const sense = entry.senses[senseIndex]!
        const xrefTexts = sense.xrefs.map((xref) => xref.split("・")[0]!).filter((text) => text.length > 0)
        const xrefMatches = yield* dictionary.findForms(xrefTexts, entry.language)
        const shared = yield* dictionary.sharedGlossCandidates(entry.id, senseIndex, MAX_CANDIDATES)

        const ids = [...new Set([...xrefMatches.map((match) => match.entryId), ...shared.map((c) => c.entryId)])]
          .filter((id) => id !== entry.id)
          .slice(0, MAX_CANDIDATES)
        const entries = yield* dictionary.getEntries(ids)

        return entries.map((candidate) =>
          candidateOf(candidate, shared.find((c) => c.entryId === candidate.id)?.sense ?? 0)
        )
      })

      /** An English word's katakana loan candidates from JMDict, most frequent first. */
      const loansFor = Effect.fnUntraced(function* (entry: EntryRecord) {
        if (entry.language !== "en") return []
        const found = yield* dictionary.loanCandidates([entry.headword], MAX_LOANS)
        const entries = new Map(
          (yield* dictionary.getEntries(found.map((candidate) => candidate.entryId))).map((e) => [e.id, e])
        )
        return found.flatMap((candidate) => {
          const loan = entries.get(candidate.entryId)
          return loan === undefined ? [] : [{ entry: loan, by: candidate.by }]
        })
      })

      const enrich = Effect.fn("NuanceEnricher.enrich")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const tags = yield* dictionary.tags
        const senses = judgedSenses(entry)
        if (senses.length === 0) return { senses: 0, similar: 0, loan: null, inputTokens: 0 }

        const candidates = yield* Effect.forEach(senses, (_, index) =>
          index < SIMILAR_SENSES ? candidatesFor(entry, index) : Effect.succeed([])
        )
        const loans = yield* loansFor(entry)
        // One request for the senses: every sense's questions, each carrying its sense's scope,
        // and the candidate comparisons. Questions run in parallel, so a learner waits one round
        // trip instead of one per sense. An English word's loan candidates are asked at the same
        // time in a request of their own, whose state leaves out the senses (`loanRequest`).
        const request = entryRequest(entry, tags, candidates)
        const loanAsked =
          loans.length === 0
            ? null
            : loanRequest(
                entry,
                loans.map((loan) => loan.entry),
                tags
              )
        const [result, loanResult] = yield* Effect.all(
          [
            jev.ask(request.state, request.questions),
            loanAsked === null ? Effect.succeed(null) : jev.ask(loanAsked.state, loanAsked.questions)
          ],
          { concurrency: 2 }
        )

        const now = yield* Clock.currentTimeMillis
        const questionsVersion = questionsVersionOf(entry.language)
        const judged = senses.map((sense, index) => ({
          index,
          tags: senseTags(sense),
          answers: answersOfSense(result.answers, index)
        }))
        const nuance = judged.map(({ index, tags: senseTagged, answers }) => ({
          sense: index,
          nuance: interpretSense(answers as unknown as SenseAnswers, senseTagged),
          answers,
          model: result.model,
          questionsVersion
        }))
        const similar = judged.flatMap(({ index, answers }) =>
          interpretCandidates(
            answers,
            (candidates[index] ?? []).map((c) => c.entryId)
          ).map((j) => ({ sense: index, ...j }))
        )
        const asked: ReadonlyArray<AskedLoan> = loans.map((loan) => ({ word: loan.entry.headword, by: loan.by }))
        const loanAnswers = loanResult === null ? {} : answersOfLoans(loanResult.answers)
        const loan = interpretLoan(loanAnswers, asked)

        yield* enrichment.saveNuance(entryId, nuance, now)
        yield* enrichment.saveSimilar(entryId, similar)
        yield* enrichment.saveLoanWord(
          entryId,
          loanResult === null
            ? null
            : { ...loan, answers: { ...loanAnswers, candidates: asked }, model: loanResult.model, questionsVersion },
          now
        )
        return {
          senses: nuance.length,
          similar: similar.length,
          loan: loan.word,
          inputTokens: result.usage.input_tokens + (loanResult?.usage.input_tokens ?? 0)
        }
      })

      const reinterpret = Effect.fn("NuanceEnricher.reinterpret")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const rows = yield* enrichment.nuanceAnswersFor(entryId)
        yield* Effect.forEach(
          rows,
          (row) => {
            const sense = entry.senses[row.sense]
            return enrichment.updateNuance(
              entryId,
              row.sense,
              interpretSense(row.answers as SenseAnswers, sense === undefined ? [] : senseTags(sense))
            )
          },
          { discard: true }
        )
        const loanAnswers = yield* enrichment.loanAnswersFor(entryId)
        if (Option.isSome(loanAnswers)) {
          const answers = loanAnswers.value as Readonly<Record<string, unknown>>
          const asked = Option.match(Schema.decodeUnknownOption(StoredLoans)(answers), {
            onNone: () => [],
            onSome: (stored) => stored.candidates
          })
          const loan = interpretLoan(answers, asked)
          yield* enrichment.updateLoanWord(entryId, loan.word, loan.verdict)
        }
        return { senses: rows.length }
      })

      return NuanceEnricher.of({ model: jev.model, enrich, reinterpret })
    })
  )
}
