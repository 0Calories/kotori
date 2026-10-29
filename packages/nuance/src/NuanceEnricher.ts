import { DictionaryRepo, EnrichmentRepo, type EntryRecord } from "@kotori/db"
import type { Question } from "@typesafe-ai/sdk"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { englishAnswersOf, englishQuestions } from "./english.ts"
import {
  type EnglishAnswers,
  interpretCandidates,
  interpretEnglish,
  interpretSense,
  type SenseAnswers
} from "./interpret.ts"
import { Jev, type JevError } from "./Jev.ts"
import { candidateQuestions, QUESTIONS_VERSION, senseQuestions } from "./questions.ts"
import { type CandidateState, senseState } from "./state.ts"

/** Senses beyond these rarely matter to learners and are left unclassified. */
const MAX_SENSES = 6
/** Similar words are looked for on the main senses only. */
const SIMILAR_SENSES = 3
const MAX_CANDIDATES = 8

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

        return entries.map((candidate): CandidateState => {
          const matchedSense = shared.find((c) => c.entryId === candidate.id)?.sense ?? 0
          const glosses = candidate.senses[matchedSense]?.glosses ?? candidate.senses[0]?.glosses ?? []
          return {
            entryId: candidate.id,
            word: candidate.headword,
            reading: candidate.reading,
            meaning: glosses
              .slice(0, 3)
              .map((gloss) => gloss.text)
              .join("; ")
          }
        })
      })

      const enrich = Effect.fn("NuanceEnricher.enrich")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const tags = yield* dictionary.tags

        const judged = yield* Effect.forEach(
          entry.senses.slice(0, MAX_SENSES),
          (sense, index) =>
            Effect.gen(function* () {
              const candidates = index < SIMILAR_SENSES ? yield* candidatesFor(entry, index) : []
              // One request per sense: the Japanese questions, the English-side ones and the
              // candidate comparisons together. TypeSafe evaluates questions in parallel, so
              // asking everything at once is barely slower or dearer than asking anything.
              const questions: Record<string, Question> = { ...senseQuestions, ...englishQuestions }
              candidates.forEach((_, i) => Object.assign(questions, candidateQuestions(i)))
              const result = yield* jev.ask(senseState(entry, index, tags, candidates), questions)
              return { index, misc: sense.misc, candidates, result }
            }),
          { concurrency: 3 }
        )

        const now = yield* Clock.currentTimeMillis
        const nuance = judged.map(({ index, misc, result }) => ({
          sense: index,
          nuance: interpretSense(result.answers as unknown as SenseAnswers, misc),
          answers: result.answers,
          model: result.model,
          questionsVersion: QUESTIONS_VERSION
        }))
        const english = judged.map(({ index, result }) => ({
          sense: index,
          nuance: interpretEnglish(result.answers as unknown as EnglishAnswers),
          answers: englishAnswersOf(result.answers),
          model: result.model,
          questionsVersion: QUESTIONS_VERSION
        }))
        const similar = judged.flatMap(({ index, candidates, result }) =>
          interpretCandidates(
            result.answers,
            candidates.map((c) => c.entryId)
          ).map((j) => ({ sense: index, ...j }))
        )

        yield* enrichment.saveNuance(entryId, nuance, now)
        yield* enrichment.saveEnglishNuance(entryId, english, now)
        yield* enrichment.saveSimilar(entryId, similar)
        return {
          senses: nuance.length,
          similar: similar.length,
          inputTokens: judged.reduce((sum, { result }) => sum + result.usage.input_tokens, 0)
        }
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
        const english = yield* enrichment.englishAnswersFor(entryId)
        yield* Effect.forEach(
          english,
          (row) => enrichment.updateEnglishNuance(entryId, row.sense, interpretEnglish(row.answers as EnglishAnswers)),
          { discard: true }
        )
        return { senses: rows.length }
      })

      return NuanceEnricher.of({ model: jev.model, enrich, reinterpret })
    })
  )
}
