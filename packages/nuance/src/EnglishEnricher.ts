import { DictionaryRepo, EnrichmentRepo, normalizeGloss } from "@kotori/db"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import {
  answersOfGloss,
  ENGLISH_QUESTIONS_VERSION,
  englishRequest,
  type JudgedGloss,
  judgedGlosses,
  type LoanCandidateEntry,
  MAX_LOANS
} from "./english.ts"
import { interpretEnglish } from "./interpret.ts"
import { Jev, type JevError } from "./Jev.ts"
import { EntryNotFound } from "./NuanceEnricher.ts"

export interface EnglishSummary {
  readonly glosses: number
  /** Glosses judged to have a katakana loan, matching or not. */
  readonly loans: number
  readonly inputTokens: number
}

/** The katakana words asked about for a gloss, kept with its answers so the loan can be re-derived. */
const StoredCandidates = Schema.Struct({
  candidates: Schema.Array(Schema.Struct({ word: Schema.String, by: Schema.Literals(["gloss", "source"]) }))
})

/**
 * The English side of an entry, for Japanese natives learning English: every leading gloss of
 * every judged sense, judged in one request (`englishRequest`). Each gloss's katakana loan
 * candidates come from the dictionary (`DictionaryRepo.loanCandidates`), and Jev only selects
 * among them. Claude's warning for a diverging loan is written by the worker afterwards.
 */
export class EnglishEnricher extends Context.Service<
  EnglishEnricher,
  {
    readonly model: string
    enrich(entryId: number): Effect.Effect<EnglishSummary, JevError | EntryNotFound>
    /** Re-derives an entry's English judgments from their stored answers, without inference. */
    reinterpret(entryId: number): Effect.Effect<{ readonly glosses: number }, EntryNotFound>
  }
>()("@kotori/nuance/EnglishEnricher") {
  static readonly layer = Layer.effect(
    EnglishEnricher,
    Effect.gen(function* () {
      const jev = yield* Jev
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo

      /** Each judged gloss's katakana candidates, most frequent first. */
      const candidatesFor = Effect.fnUntraced(function* (glosses: ReadonlyArray<JudgedGloss>) {
        const found = yield* dictionary.loanCandidates(
          glosses.map((judged) => judged.text),
          MAX_LOANS
        )
        const entries = new Map(
          (yield* dictionary.getEntries([...new Set(found.map((candidate) => candidate.entryId))])).map((entry) => [
            entry.id,
            entry
          ])
        )
        return (judged: JudgedGloss): ReadonlyArray<LoanCandidateEntry> =>
          found
            .filter((candidate) => candidate.word === normalizeGloss(judged.text))
            .flatMap((candidate) => {
              const entry = entries.get(candidate.entryId)
              return entry === undefined ? [] : [{ entry, by: candidate.by }]
            })
      })

      const enrich = Effect.fn("EnglishEnricher.enrich")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        const glosses = judgedGlosses(entry)
        if (glosses.length === 0) return { glosses: 0, loans: 0, inputTokens: 0 }

        const candidates = yield* candidatesFor(glosses)
        const request = englishRequest(entry, yield* dictionary.tags, candidates)
        const result = yield* jev.ask(request.state, request.questions)

        const now = yield* Clock.currentTimeMillis
        const rows = glosses.map((judged) => {
          const asked = candidates(judged)
            .slice(0, MAX_LOANS)
            .map((candidate) => ({ word: candidate.entry.headword, by: candidate.by }))
          const answers = { ...answersOfGloss(result.answers, judged.sense, judged.gloss), candidates: asked }
          const { judgments, loanWord } = interpretEnglish(answers, asked)
          return {
            sense: judged.sense,
            gloss: judged.gloss,
            nuance: judgments,
            answers,
            loanWord,
            model: result.model,
            questionsVersion: ENGLISH_QUESTIONS_VERSION
          }
        })
        yield* enrichment.saveEnglishNuance(entryId, rows, now)
        return {
          glosses: rows.length,
          loans: rows.filter((row) => row.loanWord !== null).length,
          inputTokens: result.usage.input_tokens
        }
      })

      const reinterpret = Effect.fn("EnglishEnricher.reinterpret")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return yield* new EntryNotFound({ entryId })
        // Older rows were judged by other questions; they are re-judged when next viewed.
        const rows = (yield* enrichment.englishAnswersFor(entryId)).filter(
          (row) => row.questionsVersion === ENGLISH_QUESTIONS_VERSION
        )
        yield* Effect.forEach(
          rows,
          (row) => {
            const answers = row.answers as Readonly<Record<string, unknown>>
            const asked = Option.match(Schema.decodeUnknownOption(StoredCandidates)(answers), {
              onNone: () => [],
              onSome: (stored) => stored.candidates
            })
            const { judgments, loanWord } = interpretEnglish(answers, asked)
            return enrichment.updateEnglishNuance(entryId, row.sense, row.gloss, judgments, loanWord)
          },
          { discard: true }
        )
        return { glosses: rows.length }
      })

      return EnglishEnricher.of({ model: jev.model, enrich, reinterpret })
    })
  )
}
