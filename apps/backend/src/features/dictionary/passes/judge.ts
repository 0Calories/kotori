import {
  FORM_BATCH,
  FORM_SURE,
  FORM_VERSION,
  type FormJudgment,
  Jev,
  judgeForm,
  judgeLoans,
  LOANS_VERSION,
  MAX_LOANS,
  PITFALL_BATCH,
  PitfallWriter,
  PITFALLS_VERSION,
  type WordPitfalls
} from "@kotori/ai"
import type { Language } from "@kotori/contracts"
import { Console, Effect, FileSystem, Path, Semaphore } from "effect"
import { chunks } from "../../../db/chunks.ts"
import type { DatabaseShape } from "../../../db/Database.ts"
import { resolveFromRoot } from "../../../runtime/Paths.ts"
import {
  type Artifact,
  type ArtifactHeader,
  ARTIFACTS,
  FormLine,
  LICENCE,
  LoanLine,
  type Pass,
  PitfallLine,
  readArtifact,
  serializeArtifact
} from "./artifacts.ts"
import {
  type FormCandidate,
  formCandidates,
  loanCandidateWords,
  type LoanCandidateWord,
  type PitfallCandidate,
  pitfallCandidates
} from "./candidates.ts"

/**
 * `kotori judge <pass>`: picks a pass's candidates from the database, asks the model, and writes
 * the artifact for review. The file is rewritten after every batch, so an interrupted run keeps
 * what it judged, and a later run asks only about words the file lacks. Nothing reaches the
 * database until the file is committed and `kotori seed` imports it (`apply.ts`).
 */

export interface JudgeOptions {
  /** How many words to judge this run. */
  readonly limit: number
  /** List what would be asked, without calling a model or writing the file. */
  readonly dryRun: boolean
  readonly concurrency: number
  /** Only words the dictionary marks common. */
  readonly commonOnly: boolean
  /** Discard a file written by another model or prompt version and start over. */
  readonly restart: boolean
  /** Where the artifact is, if not its place in `data/` (tests). */
  readonly file?: string | undefined
}

export interface JudgeSummary {
  readonly candidates: number
  readonly judged: number
  readonly failed: number
  /** Model requests this run made, or would make on a dry run. */
  readonly requests: number
}

const keyOf: { [P in Pass]: (line: never) => string | number } = {
  "ja-form": (line: FormLine) => line.entryId,
  "pitfalls-ja": (line: PitfallLine) => line.entryId,
  "pitfalls-en": (line: PitfallLine) => line.entryId,
  loans: (line: LoanLine) => line.englishId
}

/**
 * The lines already judged by this model and prompt version, keyed as the file sorts them. A file
 * from another model or version fails the run, unless `restart` starts it over: mixing two
 * versions in one file would make its header a lie.
 */
const startFrom = Effect.fnUntraced(function* <L>(
  pass: Pass,
  file: string,
  existing: Artifact<L> | null,
  header: ArtifactHeader,
  restart: boolean
) {
  const lines = new Map<string | number, L>()
  if (existing === null) return lines
  const same = existing.header.model === header.model && existing.header.promptVersion === header.promptVersion
  if (!same && !restart) {
    return yield* Effect.fail(
      `${file} was written by ${existing.header.model}, prompt version ${existing.header.promptVersion}; ` +
        `this run would use ${header.model}, version ${header.promptVersion}. Pass --restart to judge every word again.`
    )
  }
  if (same) for (const line of existing.lines) lines.set((keyOf[pass] as (line: L) => string | number)(line), line)
  return lines
})

/** Runs `batches` with a writer that rewrites the file after each, one writer at a time. */
const runBatches = Effect.fnUntraced(function* <B, L>(options: {
  readonly pass: Pass
  readonly file: string
  readonly header: ArtifactHeader
  readonly lines: Map<string | number, L>
  readonly batches: ReadonlyArray<B>
  readonly concurrency: number
  readonly size: (batch: B) => number
  readonly judge: (batch: B) => Effect.Effect<ReadonlyArray<L>, unknown>
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = resolveFromRoot(options.file)
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  const key = keyOf[options.pass] as (line: L) => string | number
  const saving = yield* Semaphore.make(1)
  let judged = 0
  let failed = 0
  const total = options.batches.reduce((sum, batch) => sum + options.size(batch), 0)
  yield* Effect.forEach(
    options.batches,
    (batch) =>
      options.judge(batch).pipe(
        Effect.flatMap((written) =>
          Semaphore.withPermit(saving)(
            Effect.gen(function* () {
              for (const line of written) options.lines.set(key(line), line)
              judged += written.length
              failed += options.size(batch) - written.length
              yield* fs.writeFileString(file, serializeArtifact(options.header, options.lines.values(), key))
              yield* Console.log(`Judged ${judged}/${total}`)
            })
          )
        ),
        Effect.catch((error) =>
          Effect.logWarning(`A batch of ${options.size(batch)} failed: ${String(error)}`).pipe(
            Effect.tap(() => Effect.sync(() => (failed += options.size(batch))))
          )
        )
      ),
    { concurrency: options.concurrency, discard: true }
  )
  return { judged, failed }
})

const listSome = (names: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const name of names.slice(0, 20)) yield* Console.log(`  ${name}`)
    if (names.length > 20) yield* Console.log(`  … and ${names.length - 20} more`)
  })

/** Groups words so each request asks about at most `FORM_BATCH` senses. */
const formBatches = (candidates: ReadonlyArray<FormCandidate>) => {
  const batches: Array<Array<FormCandidate>> = []
  let current: Array<FormCandidate> = []
  let senses = 0
  for (const candidate of candidates) {
    if (current.length > 0 && senses + candidate.senses.length > FORM_BATCH) {
      batches.push(current)
      current = []
      senses = 0
    }
    current.push(candidate)
    senses += candidate.senses.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** A judged word's line: its senses at or above `FORM_SURE`; none when a sense went unanswered. */
export const formLines = (
  batch: ReadonlyArray<FormCandidate>,
  judgments: ReadonlyArray<FormJudgment>
): ReadonlyArray<FormLine> =>
  batch.flatMap((candidate) => {
    const own = judgments.filter((judgment) => judgment.word === candidate.word)
    if (own.length < candidate.senses.length) return []
    return [
      {
        entryId: candidate.entryId,
        headword: candidate.word.headword,
        form: own
          .filter((judgment) => judgment.p >= FORM_SURE)
          .map((judgment) => ({
            gloss: candidate.word.senses[judgment.sense]!.glosses[0]!,
            p: Math.round(judgment.p * 100) / 100
          }))
      }
    ]
  })

export const judgeFormPass = Effect.fn("judge.ja-form")(function* (db: DatabaseShape, options: JudgeOptions) {
  const jev = yield* Jev
  const header: ArtifactHeader = { pass: "ja-form", model: jev.model, promptVersion: FORM_VERSION, licence: LICENCE }
  const file = options.file ?? ARTIFACTS["ja-form"]
  const lines = yield* startFrom("ja-form", file, yield* readArtifact(file, FormLine), header, options.restart)
  const candidates = yield* formCandidates(db, {
    commonOnly: options.commonOnly,
    judged: new Set([...lines.keys()].map(Number)),
    limit: options.limit
  })
  const batches = formBatches(candidates)
  const senses = candidates.reduce((sum, candidate) => sum + candidate.senses.length, 0)
  yield* Console.log(
    `${lines.size} words judged so far; judging ${candidates.length} more (${senses} senses, ${batches.length} Jev requests).`
  )
  if (options.dryRun) {
    yield* listSome(
      candidates.map(
        (candidate) =>
          `${candidate.word.headword}: ${candidate.senses.map((sense) => candidate.word.senses[sense]!.glosses[0]).join(" | ")}`
      )
    )
    return { candidates: candidates.length, judged: 0, failed: 0, requests: batches.length } satisfies JudgeSummary
  }
  if (!jev.configured) return yield* Effect.fail("TYPESAFE_API_KEY is not set; the ja-form pass needs Jev.")
  const run = yield* runBatches({
    pass: "ja-form",
    file,
    header,
    lines,
    batches,
    concurrency: options.concurrency,
    size: (batch) => batch.length,
    judge: (batch) =>
      judgeForm(
        jev,
        batch.flatMap((candidate) => candidate.senses.map((sense) => ({ word: candidate.word, sense })))
      ).pipe(Effect.map((judgments) => formLines(batch, judgments)))
  })
  return { candidates: candidates.length, ...run, requests: batches.length } satisfies JudgeSummary
})

/** A word's line from the writer's result; none when Claude skipped the word. */
export const pitfallLines = (
  batch: ReadonlyArray<PitfallCandidate>,
  results: ReadonlyArray<WordPitfalls>
): ReadonlyArray<PitfallLine> =>
  batch.flatMap((candidate, index) => {
    const result = results[index]
    if (result === undefined || result.missing) return []
    return [
      {
        entryId: candidate.entryId,
        headword: candidate.word.headword,
        pitfalls: result.pitfalls.map((pitfall) => ({
          kind: pitfall.kind,
          text: pitfall.text,
          sense: pitfall.sense === null ? null : (candidate.word.senses[pitfall.sense]?.glosses[0] ?? null),
          about: pitfall.about
        }))
      }
    ]
  })

export const judgePitfallPass = Effect.fn("judge.pitfalls")(function* (
  db: DatabaseShape,
  language: Language,
  options: JudgeOptions
) {
  const writer = yield* PitfallWriter
  const pass = `pitfalls-${language}` as const
  const header: ArtifactHeader = { pass, model: writer.model, promptVersion: PITFALLS_VERSION, licence: LICENCE }
  const file = options.file ?? ARTIFACTS[pass]
  const lines = yield* startFrom(pass, file, yield* readArtifact(file, PitfallLine), header, options.restart)
  const candidates = yield* pitfallCandidates(db, {
    language,
    commonOnly: options.commonOnly,
    judged: new Set([...lines.keys()].map(Number)),
    limit: options.limit
  })
  const batches = chunks(candidates, PITFALL_BATCH)
  yield* Console.log(
    `${lines.size} words judged so far; judging ${candidates.length} more (${batches.length} Claude requests).`
  )
  if (options.dryRun) {
    yield* listSome(candidates.map((candidate) => candidate.word.headword))
    return { candidates: candidates.length, judged: 0, failed: 0, requests: batches.length } satisfies JudgeSummary
  }
  const run = yield* runBatches({
    pass,
    file,
    header,
    lines,
    batches,
    concurrency: options.concurrency,
    size: (batch) => batch.length,
    judge: (batch) =>
      writer
        .write(
          batch.map((candidate) => candidate.word),
          language
        )
        .pipe(Effect.map((results) => pitfallLines(batch, results)))
  })
  return { candidates: candidates.length, ...run, requests: batches.length } satisfies JudgeSummary
})

/** Loan requests per saved batch: one request a word. */
const LOAN_SAVE_EVERY = 20

export const judgeLoanPass = Effect.fn("judge.loans")(function* (db: DatabaseShape, options: JudgeOptions) {
  const jev = yield* Jev
  const header: ArtifactHeader = { pass: "loans", model: jev.model, promptVersion: LOANS_VERSION, licence: LICENCE }
  const file = options.file ?? ARTIFACTS.loans
  const lines = yield* startFrom("loans", file, yield* readArtifact(file, LoanLine), header, options.restart)
  const words = yield* loanCandidateWords(
    db,
    { commonOnly: options.commonOnly, judged: new Set([...lines.keys()].map(Number)), limit: options.limit },
    MAX_LOANS
  )
  const batches = chunks(words, LOAN_SAVE_EVERY)
  yield* Console.log(`${lines.size} words judged so far; judging ${words.length} more (${words.length} Jev requests).`)
  if (options.dryRun) {
    yield* listSome(
      words.map(
        (word) =>
          `${word.english}: ${word.candidates.map((candidate) => `${candidate.katakana} (${candidate.by})`).join(", ")}`
      )
    )
    return { candidates: words.length, judged: 0, failed: 0, requests: words.length } satisfies JudgeSummary
  }
  if (!jev.configured) return yield* Effect.fail("TYPESAFE_API_KEY is not set; the loans pass needs Jev.")
  const run = yield* runBatches({
    pass: "loans",
    file,
    header,
    lines,
    batches,
    concurrency: options.concurrency,
    size: (batch: ReadonlyArray<LoanCandidateWord>) => batch.length,
    judge: (batch) =>
      judgeLoans(jev, batch, 4).pipe(
        Effect.map((readings) =>
          batch.map((word, index): LoanLine => {
            const reading = readings[index]!
            const candidate = word.candidates.find((own) => own.katakana === reading.katakana)
            return {
              english: word.english,
              englishId: word.entryId,
              katakana: reading.katakana,
              katakanaId: candidate?.entryId ?? null,
              meaning: reading.meaning,
              p: reading.p === null ? null : Math.round(reading.p * 100) / 100
            }
          })
        )
      )
  })
  return { candidates: words.length, ...run, requests: words.length } satisfies JudgeSummary
})
