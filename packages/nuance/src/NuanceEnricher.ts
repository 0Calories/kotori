import { DictionaryRepo, EnrichmentRepo, type EntryRecord } from "@kotori/db"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { interpretCandidates, interpretSense, type SenseAnswers } from "./interpret.ts"
import { Jev, type JevError } from "./Jev.ts"
import { answersOfSense, entryRequest, QUESTIONS_VERSION } from "./questions.ts"
import { candidateOf, judgedSenses, MAX_CANDIDATES, SIMILAR_SENSES } from "./state.ts"

export class EntryNotFound extends Schema.TaggedError<EntryNotFound>()("EntryNotFound", { entryId: Schema.Int }) {}

export interface NuanceSummary {
  readonly senses: number
  readonly similar: number
  readonly inputTokens: number
}

export class NuanceEnricher extends Context.Service<
  NuanceEnricher,
  {
    readonly model: string
    enrich(entryId: number): Effect.Effect<NuanceSummary, JevError | EntryNotFound>
    /** Re-derives an entry's nuance from its stored answers and tags, without inference. */
    reinterpret(entryId: number): Effect.Effect<{ readonly senses: number }, EntryNotFound>
  }
>()("@kotori/nuance/NuanceEnricher") {
  static readonly layer = Layer.effect(
    NuanceEnricher,
    Effect.gen(function* () {
      const jev = yield* Jev
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo

      /** JMDict "see also" references first (curated), then words sharing an exact gloss. */
      const candidatesFor = Effect.fnUntraced(function* (entry: EntryRecord, senseIndex: number) {
        const sense = entry.senses[senseIndex]!
        const xrefTexts = sense.xrefs.map((xref) => xref.split("・")[0]!).filter((text) => text.length > 0)
        const xrefMatches = yield* dictionary.findForms(xrefTexts)
        const shared = yield* dictionary.sharedGlossCandidates(entry.id, senseIndex, MAX_CANDIDATES)

        const ids = [...new Set([...xrefMatches.map((match) => match.entryId), ...shared.map((c) => c.entryId)])]
          .filter((id) => id !== entry.id)
          .slice(0, MAX_CANDIDATES)
        const entries = yield* dictionary.getEntries(ids)

        return entries.map((candidate) =>
          candidateOf(candidate, shared.find((c) => c.entryId === candidate.id)?.sense ?? 0)
        )
      })

      const enrich = Effect.fn("NuanceEnricher.enrich")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const tags = yield* dictionary.tags
        const senses = judgedSenses(entry)
        if (senses.length === 0) return { senses: 0, similar: 0, inputTokens: 0 }

        const candidates = yield* Effect.forEach(senses, (_, index) =>
          index < SIMILAR_SENSES ? candidatesFor(entry, index) : Effect.succeed([])
        )
        // One request for the whole entry: every sense's questions, each carrying its sense's
        // scope, and the candidate comparisons. Questions run in parallel, so a learner waits
        // one round trip instead of one per sense.
        const request = entryRequest(entry, tags, candidates)
        const result = yield* jev.ask(request.state, request.questions)

        const now = yield* Clock.currentTimeMillis
        const judged = senses.map((sense, index) => ({
          index,
          misc: sense.misc,
          answers: answersOfSense(result.answers, index)
        }))
        const nuance = judged.map(({ index, misc, answers }) => ({
          sense: index,
          nuance: interpretSense(answers as unknown as SenseAnswers, misc),
          answers,
          model: result.model,
          questionsVersion: QUESTIONS_VERSION
        }))
        const similar = judged.flatMap(({ index, answers }) =>
          interpretCandidates(
            answers,
            (candidates[index] ?? []).map((c) => c.entryId)
          ).map((j) => ({ sense: index, ...j }))
        )

        yield* enrichment.saveNuance(entryId, nuance, now)
        yield* enrichment.saveSimilar(entryId, similar)
        return { senses: nuance.length, similar: similar.length, inputTokens: result.usage.input_tokens }
      })

      const reinterpret = Effect.fn("NuanceEnricher.reinterpret")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const rows = yield* enrichment.nuanceAnswersFor(entryId)
        yield* Effect.forEach(
          rows,
          (row) =>
            enrichment.updateNuance(
              entryId,
              row.sense,
              interpretSense(row.answers as SenseAnswers, entry.senses[row.sense]?.misc ?? [])
            ),
          { discard: true }
        )
        return { senses: rows.length }
      })

      return NuanceEnricher.of({ model: jev.model, enrich, reinterpret })
    })
  )
}
