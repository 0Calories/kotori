import type { EntryRecord } from "@kotori/db"
import { normalizeGloss, resolveFromRoot } from "@kotori/db"
import { LOAN_SHOWN, loanShown } from "@kotori/domain"
import {
  answersForCandidates,
  ENGLISH_QUESTIONS_VERSION,
  type EvalRequest,
  GOLDEN_ENGLISH_PAIRS,
  GOLDEN_ENGLISH_SENSES,
  GOLDEN_FIXTURE,
  GOLDEN_LOANS,
  GOLDEN_PAIRS,
  GOLDEN_SENSES,
  goldenEnglishEntry,
  type GoldenExpectation,
  GoldenFixture,
  goldenEntry,
  goldenLoanRequest,
  type GoldenPairExpectation,
  goldenPairRequest,
  goldenSenseRequest,
  interpretLoan,
  interpretSense,
  Jev,
  type JevError,
  LOAN_IS,
  loanMeanings,
  type LoanReading,
  MAX_LOANS,
  type OrderCheck,
  QUESTIONS_VERSION,
  readGolden,
  type SenseAnswers,
  senseTags,
  SIMILAR_KEPT
} from "@kotori/nuance"
import { Console, Effect, FileSystem, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

/** Booleans are judged where the app judges them: the display threshold. */
const CAUTION_SHOWN = 0.6
/** Near-synonym cut-offs compared on the golden pairs: a coin flip, and the docs' starting point for yes. */
const SIMILAR_AT = [0.5, 0.7] as const

interface Tally {
  n: number
  correct: number
  confidenceCorrect: Array<number>
  confidenceWrong: Array<number>
}

interface Order {
  n: number
  flipped: number
  towardFirst: number
}

/**
 * One dimension's results. `jev` and `jmdict` split the judgments learners are shown by who
 * decided them, so JMDict's tags don't inflate Jev's accuracy; `raw` is Jev's own answer on
 * every golden, tags ignored; `order` compares each Choice with its options reversed.
 */
interface Row {
  readonly jev: Tally
  readonly jmdict: Tally
  readonly raw: Tally
  readonly order: Order
}

const tally = (): Tally => ({ n: 0, correct: 0, confidenceCorrect: [], confidenceWrong: [] })

const count = (t: Tally, correct: boolean, confidence: number | null) => {
  t.n += 1
  if (correct) t.correct += 1
  if (confidence !== null) (correct ? t.confidenceCorrect : t.confidenceWrong).push(confidence)
}

interface Judged {
  readonly correct: boolean
  readonly confidence: number | null
}

const makeResults = () => {
  const rows = new Map<string, Row>()
  const misses: Array<string> = []
  const failures: Array<string> = []
  const row = (dimension: string) => {
    const found = rows.get(dimension)
    if (found !== undefined) return found
    const created = { jev: tally(), jmdict: tally(), raw: tally(), order: { n: 0, flipped: 0, towardFirst: 0 } }
    rows.set(dimension, created)
    return created
  }
  return {
    rows,
    misses,
    failures,
    /** A judgment as learners see it, and Jev's own answer where JMDict's tags can override it. */
    judged: (dimension: string, byTag: boolean, shown: Judged, miss: string, raw?: Judged) => {
      const r = row(dimension)
      count(byTag ? r.jmdict : r.jev, shown.correct, shown.confidence)
      if (raw !== undefined) count(r.raw, raw.correct, raw.confidence)
      if (!shown.correct) misses.push(`${byTag ? "[jmdict] " : ""}${miss}`)
    },
    order: (dimension: string, check: OrderCheck) => {
      const order = row(dimension).order
      order.n += 1
      if (check.flipped) order.flipped += 1
      if (check.towardFirst) order.towardFirst += 1
    }
  }
}

type Results = ReturnType<typeof makeResults>

const oneOf = (wanted: ReadonlyArray<string>, value: string) => wanted.includes(value)
const mean = (xs: ReadonlyArray<number>) => (xs.length === 0 ? null : xs.reduce((sum, x) => sum + x, 0) / xs.length)
const percent = (part: number, whole: number) =>
  whole === 0 ? "   —" : `${((100 * part) / whole).toFixed(0)}%`.padStart(4)
const two = (x: number | null) => (x === null ? "  — " : x.toFixed(2))

const report = (results: Results) =>
  Effect.gen(function* () {
    yield* Console.log(
      [
        "",
        "                    Jev decides               JMDict decides   Jev, tags ignored   Options reversed",
        "dimension            n   acc  conf✓  conf✗      n   acc          n   acc           n  flips  to first"
      ].join("\n")
    )
    for (const [dimension, { jev, jmdict, raw, order }] of results.rows) {
      const share = (t: Tally) => `${String(t.n).padStart(4)}  ${percent(t.correct, t.n)}`
      yield* Console.log(
        [
          dimension.padEnd(18),
          `${share(jev)}  ${two(mean(jev.confidenceCorrect))}   ${two(mean(jev.confidenceWrong))}`,
          `   ${share(jmdict)}`,
          `       ${share(raw)}`,
          order.n === 0
            ? ""
            : `       ${String(order.n).padStart(4)}  ${percent(order.flipped, order.n)}  ${String(order.towardFirst).padStart(5)}`
        ].join(" ")
      )
    }
    if (results.misses.length > 0) {
      yield* Console.log("\nMisses (shown to learners):")
      for (const miss of results.misses) yield* Console.log(`  ${miss}`)
    }
    if (results.failures.length > 0) {
      yield* Console.log("\nFailed requests:")
      for (const failure of results.failures) yield* Console.log(`  ${failure}`)
    }
  })

const summary = (results: Results) =>
  Object.fromEntries(
    [...results.rows].map(([dimension, { jev, jmdict, raw, order }]) => [
      dimension,
      {
        jev: { n: jev.n, correct: jev.correct, confidence: mean([...jev.confidenceCorrect, ...jev.confidenceWrong]) },
        jmdict: { n: jmdict.n, correct: jmdict.correct },
        raw: { n: raw.n, correct: raw.correct },
        order
      }
    ])
  )

/** The recorded answers of a run, for offline reinterpretation with --from. */
const Recording = Schema.Struct({
  kind: Schema.String,
  model: Schema.String,
  questionsVersion: Schema.Int,
  answers: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
})

/** The labelled judgments of a sense's nuance; every one carries a value, a confidence and its source. */
type LabelledDimension =
  | "formality"
  | "medium"
  | "keigo"
  | "gender"
  | "age"
  | "currency"
  | "connotation"
  | "registerShape"
  | "variety"
  | "profanity"
interface Labelled {
  readonly value: string
  readonly confidence: number
  readonly source: string
}

type Answers = Readonly<Record<string, unknown>>

interface NoulAnswer {
  readonly noul: number
}
interface ChoiceAnswer {
  readonly choice: string
  readonly confidence: number
}

/** A golden sense to judge, of either dictionary. */
interface SenseCase {
  readonly key: string
  readonly label: string
  readonly entry: EntryRecord
  readonly sense: number
  readonly expect: GoldenExpectation
}

/** A golden pair to judge, of either dictionary. */
interface PairCase {
  readonly key: string
  readonly label: string
  readonly entry: EntryRecord
  readonly sense: number
  readonly similar: EntryRecord
  readonly similarSense: number
  readonly expect: GoldenPairExpectation
}

/**
 * Runs the current questions against the golden set and reports per-question accuracy,
 * confidence and option-order agreement. The golden entries come from `GOLDEN_FIXTURE`, real
 * JMDict and English-dictionary data, and every request is built by the production builders.
 * Costs inference: run deliberately, not in CI. With --record, the raw answers are written as
 * JSON so interpretation changes can be evaluated offline against the same answers (--from).
 */
export const evaluate = Command.make(
  "eval",
  {
    kind: Argument.Literals("kind", ["nuance", "english"]).pipe(
      Argument.withDescription(
        "nuance (Japanese words: their questions and similar-word pairs) or english (English words: theirs, and their katakana loans)"
      )
    ),
    record: Flag.String("record").pipe(
      Flag.withDescription("Write the raw answers to this JSON file, for offline reinterpretation"),
      Flag.optional
    ),
    from: Flag.String("from").pipe(
      Flag.withDescription("Reinterpret previously recorded answers from this JSON file instead of calling Jev"),
      Flag.optional
    ),
    concurrency: Flag.Int("concurrency").pipe(Flag.withDescription("Requests in parallel"), Flag.withDefault(4))
  },
  Effect.fn(function* ({ kind, record, from, concurrency }) {
    const jev = yield* Jev
    const fs = yield* FileSystem.FileSystem
    const fixture = yield* fs
      .readFileString(resolveFromRoot(GOLDEN_FIXTURE))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(GoldenFixture))))
    const recording = Option.isSome(from)
      ? yield* fs
          .readFileString(from.value)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Recording))))
      : null
    if (recording === null && !jev.configured) {
      return yield* Console.error("TYPESAFE_API_KEY is not set; eval needs Jev (or --from a recording).")
    }
    if (recording !== null && recording.kind !== kind) {
      return yield* Console.error(`${from.pipe(Option.getOrElse(() => ""))} records a ${recording.kind} eval.`)
    }

    const tags = new Map(Object.entries(fixture.tags))
    const entries = new Map(fixture.entries.map((entry) => [entry.id, goldenEntry(entry)]))
    const entryOf = (id: number) => {
      const entry = entries.get(id)
      if (entry === undefined) throw new Error(`#${id} is not in ${GOLDEN_FIXTURE}; run \`pnpm golden\``)
      return entry
    }
    const englishOf = (headword: string) => {
      const entry = goldenEnglishEntry(entries.values(), headword)
      if (entry === undefined) throw new Error(`"${headword}" is not in ${GOLDEN_FIXTURE}; run \`pnpm golden\``)
      return entry
    }
    const results = makeResults()
    const recorded: Record<string, Answers> = {}
    let inputTokens = 0

    /** Fresh answers from Jev, or the recorded ones; a failed request is reported and skipped. */
    const answersFor = (key: string, request: EvalRequest): Effect.Effect<Answers | undefined> => {
      const answers: Effect.Effect<Answers | undefined, JevError> =
        recording === null
          ? jev.ask(request.state, { ...request.questions }).pipe(
              Effect.map((result) => {
                inputTokens += result.usage.input_tokens
                return result.answers
              })
            )
          : Effect.succeed(recording.answers[key])
      return answers.pipe(
        Effect.tap((answers) =>
          Effect.sync(() => {
            if (answers !== undefined) recorded[key] = answers
          })
        ),
        Effect.catchTag("JevError", (error) =>
          Effect.sync(() => {
            results.failures.push(`${key}: ${error.message}`)
            return undefined
          })
        )
      )
    }

    const model = recording?.model ?? jev.model
    const version = recording?.questionsVersion ?? (kind === "nuance" ? QUESTIONS_VERSION : ENGLISH_QUESTIONS_VERSION)

    /** Scores a golden sense as learners see it, and Jev's own answers with the tags ignored. */
    const judgeSense = (golden: SenseCase) =>
      Effect.gen(function* () {
        const request = goldenSenseRequest(golden.entry, golden.sense, tags)
        const answers = yield* answersFor(golden.key, request)
        if (answers === undefined) return
        const reading = readGolden(request, answers)
        for (const check of reading.order) results.order(check.name, check)

        const answered = reading.answers as unknown as SenseAnswers
        const sense = golden.entry.senses[golden.sense]
        const shown = interpretSense(answered, sense === undefined ? [] : senseTags(sense), sense?.fields)
        const raw = interpretSense(answered, [])
        const { expect, label } = golden
        const labelled = (dimension: LabelledDimension, want: ReadonlyArray<string>) => {
          const judgment: Labelled | undefined = shown[dimension]
          const own: Labelled | undefined = raw[dimension]
          if (judgment === undefined || own === undefined) return
          results.judged(
            dimension,
            judgment.source === "jmdict",
            { correct: want.includes(judgment.value), confidence: judgment.confidence },
            `${label} ${dimension}: got ${judgment.value}, wanted ${want.join("|")}`,
            { correct: want.includes(own.value), confidence: own.confidence }
          )
        }
        if (expect.formality) labelled("formality", expect.formality)
        if (expect.medium) labelled("medium", expect.medium)
        if (expect.keigo) labelled("keigo", [expect.keigo])
        if (expect.gender) labelled("gender", [expect.gender])
        if (expect.age) labelled("age", [expect.age])
        if (expect.currency) labelled("currency", [expect.currency])
        if (expect.connotation) labelled("connotation", [expect.connotation])
        if (expect.registerShape) labelled("registerShape", [expect.registerShape])
        if (expect.variety) labelled("variety", [expect.variety])
        if (expect.profanity) labelled("profanity", [expect.profanity])

        // A caution counts as decided by the dictionary when a tag changed it from Jev's own answer.
        const caution = (dimension: string, p: number | undefined, own: number | undefined, want: boolean) => {
          if (p === undefined || own === undefined) return
          results.judged(
            dimension,
            p !== own,
            { correct: p >= CAUTION_SHOWN === want, confidence: p },
            `${label} ${dimension}: p=${p.toFixed(2)}, wanted ${want ? ">=" : "<"} ${CAUTION_SHOWN}`,
            { correct: own >= CAUTION_SHOWN === want, confidence: own }
          )
        }
        const { cautions } = shown
        if (expect.rudeToSuperiors !== undefined)
          caution("rudeToSuperiors", cautions.rudeToSuperiors, raw.cautions.rudeToSuperiors, expect.rudeToSuperiors)
        if (expect.stiffWithFriends !== undefined) {
          caution("stiffWithFriends", cautions.stiffWithFriends, raw.cautions.stiffWithFriends, expect.stiffWithFriends)
          // English words are asked it too, so the derivation can be measured against the question.
          const asked = (answered as { readonly stiffWithFriends?: NoulAnswer }).stiffWithFriends?.noul
          caution("stiff, asked", asked, asked, expect.stiffWithFriends)
        }
        if (expect.slang !== undefined) caution("slang", cautions.slang, raw.cautions.slang, expect.slang)
        if (expect.textbook !== undefined)
          caution("textbook", cautions.textbook, raw.cautions.textbook, expect.textbook)
      })

    const judgePair = (pair: PairCase) =>
      Effect.gen(function* () {
        const request = goldenPairRequest(pair.entry, pair.sense, pair.similar, pair.similarSense, tags)
        const answers = yield* answersFor(pair.key, request)
        if (answers === undefined) return
        const reading = readGolden(request, answers)
        for (const check of reading.order) results.order("difference", check)
        const similarity = (reading.answers["similar_0"] as NoulAnswer).noul
        for (const at of SIMILAR_AT) {
          results.judged(
            `similar@${at}`,
            false,
            { correct: similarity >= at === pair.expect.similar, confidence: similarity },
            `${pair.label} similar: p=${similarity.toFixed(2)}, wanted ${pair.expect.similar ? ">=" : "<"} ${at}`
          )
        }
        if (pair.expect.similar && pair.expect.difference !== undefined) {
          const difference = reading.answers["difference_0"] as ChoiceAnswer
          results.judged(
            "difference",
            false,
            { correct: oneOf(pair.expect.difference, difference.choice), confidence: difference.confidence },
            `${pair.label} difference: got ${difference.choice}, wanted ${pair.expect.difference.join("|")}`
          )
        }
      })

    if (kind === "nuance") {
      yield* Console.log(
        `Judging ${GOLDEN_SENSES.length} golden senses and ${GOLDEN_PAIRS.length} similar-word pairs with ${model}, questions version ${version}…`
      )
      yield* Effect.forEach(
        GOLDEN_SENSES,
        (golden) =>
          judgeSense({
            key: `${golden.entryId}:${golden.sense}`,
            label: `${golden.word}#${golden.sense}`,
            entry: entryOf(golden.entryId),
            sense: golden.sense,
            expect: golden.expect
          }),
        { concurrency, discard: true }
      )
      yield* Effect.forEach(
        GOLDEN_PAIRS,
        (pair) =>
          judgePair({
            key: `${pair.entryId}:${pair.sense}~${pair.similarId}`,
            label: `${pair.word}→${pair.similar}`,
            entry: entryOf(pair.entryId),
            sense: pair.sense,
            similar: entryOf(pair.similarId),
            similarSense: pair.similarSense,
            expect: pair.expect
          }),
        { concurrency, discard: true }
      )
    } else {
      yield* Console.log(
        `Judging ${GOLDEN_ENGLISH_SENSES.length} golden English senses, ${GOLDEN_ENGLISH_PAIRS.length} pairs and ${GOLDEN_LOANS.length} katakana loans with ${model}, questions version ${version}…`
      )
      yield* Effect.forEach(
        GOLDEN_ENGLISH_SENSES,
        (golden) =>
          judgeSense({
            key: `${golden.word}:${golden.sense}`,
            label: `${golden.word}#${golden.sense}`,
            entry: englishOf(golden.word),
            sense: golden.sense,
            expect: golden.expect
          }),
        { concurrency, discard: true }
      )
      yield* Effect.forEach(
        GOLDEN_ENGLISH_PAIRS,
        (pair) =>
          judgePair({
            key: `${pair.word}:${pair.sense}~${pair.similar}:${pair.similarSense}`,
            label: `${pair.word}→${pair.similar}`,
            entry: englishOf(pair.word),
            sense: pair.sense,
            similar: englishOf(pair.similar),
            similarSense: pair.similarSense,
            expect: pair.expect
          }),
        { concurrency, discard: true }
      )
      yield* Effect.forEach(
        GOLDEN_LOANS,
        (golden) =>
          Effect.gen(function* () {
            const entry = englishOf(golden.word)
            // The candidates production finds now (gloss matches) and once JMDict is re-imported
            // with lsource; asked about together, read for each list on its own.
            const loans = fixture.loans[normalizeGloss(golden.word)] ?? { glossesOnly: [], withSources: [] }
            const listOf = (candidates: typeof loans.glossesOnly) =>
              candidates.map(({ entryId, by }) => ({ entry: entryOf(entryId), by }))
            const lists = { now: listOf(loans.glossesOnly), reimported: listOf(loans.withSources) }
            const union = [
              ...new Map(
                [...lists.reimported, ...lists.now].map((candidate) => [candidate.entry.id, candidate])
              ).values()
            ].slice(0, MAX_LOANS)
            const request = goldenLoanRequest(
              entry,
              union.map((candidate) => candidate.entry),
              tags
            )
            const answers = union.length === 0 ? {} : yield* answersFor(`${golden.word}:loan`, request)
            if (answers === undefined) return
            const reading = readGolden(request, answers)
            // Held-out words are reported apart, so tuning on the others can't flatter them.
            const set = golden.heldOut ? "held out: " : ""
            for (const check of reading.order) results.order(`${set}${check.name.replace(/_\d+$/, "")}`, check)
            const asked = union.map((candidate) => candidate.entry.headword)
            const readFor = (list: typeof lists.now, loanIs?: number) => {
              const own = list.slice(0, MAX_LOANS).map(({ entry: { headword }, by }) => ({ word: headword, by }))
              const words = own.map((candidate) => candidate.word)
              return interpretLoan(answersForCandidates(reading.answers, asked, words), own, loanIs)
            }
            const wanted = `${golden.loan}${golden.loanWord ? ` (${golden.loanWord})` : ""}`
            const loan = (dimension: string, read: LoanReading) => {
              const got = read.verdict?.value ?? "no_loan"
              const right = got === golden.loan && (golden.loan === "no_loan" || read.word === golden.loanWord)
              results.judged(
                `${set}${dimension}`,
                false,
                { correct: right, confidence: read.verdict?.probability ?? null },
                `${golden.word} ${set}${dimension}: got ${got}${read.word ? ` (${read.word})` : ""}, wanted ${wanted}`
              )
            }
            loan("loan, glosses", readFor(lists.now))
            const reimported = readFor(lists.reimported)
            loan("loan, +lsource", reimported)
            loan("loan, +lsrc @0.5", readFor(lists.reimported, 0.5))
            // What learners see once JMDict has lsource, by the app's rule: a warning on a drifted
            // loan, a "same meaning" chip on one carried over as is, or nothing.
            const verdict = reimported.verdict
            const shown = verdict === null ? null : loanShown(verdict)
            const about = reimported.word === golden.loanWord
            const display = (dimension: string, applies: boolean, correct: boolean) => {
              if (!applies) return
              results.judged(
                `${set}${dimension}`,
                false,
                { correct, confidence: shown === null ? null : (verdict?.probability ?? null) },
                `${golden.word} ${set}${dimension}: shown ${shown === null || verdict === null ? "nothing" : `${shown} (${reimported.word}) at ${verdict.probability.toFixed(2)}`}, wanted ${wanted}`
              )
            }
            display("warning shown", golden.loan === "divergent", shown === "warning" && about)
            display("no false warning", true, shown !== "warning" || (golden.loan === "divergent" && about))
            display("same-meaning chip", golden.loan === "same", shown === "chip" && about)
            display("no wrong chip", true, shown !== "chip" || (golden.loan === "same" && about))
            // What "not English" takes from the true loan, which is always borrowed from English.
            const meanings =
              golden.loanWord === undefined ? undefined : loanMeanings(reading.answers, asked.indexOf(golden.loanWord))
            if (meanings !== undefined) {
              results.judged(
                `${set}not English`,
                false,
                {
                  correct: meanings.not_english < Math.max(meanings.same, meanings.divergent),
                  confidence: meanings.not_english
                },
                `${golden.word} ${set}not English: p=${meanings.not_english.toFixed(2)} for ${golden.loanWord}`
              )
            }
          }),
        { concurrency, discard: true }
      )
      yield* Console.log(
        `A loan counts at p >= ${LOAN_IS} that the katakana word is the English word's loan; "glosses" are the candidates production finds until JMDict is re-imported with lsource. The app shows a warning at p(divergent) >= ${LOAN_SHOWN} and a "same meaning" chip at p(same) >= ${LOAN_SHOWN}; each p averaged over the loan Choice asked in both option orders. The conf columns of loan rows hold that p, and of "not English" the true loan's p(not_english).`
      )
    }
    yield* Console.log(`The enricher keeps a similar word at p >= ${SIMILAR_KEPT}.`)

    yield* report(results)
    if (recording === null) yield* Console.log(`\n${inputTokens.toLocaleString()} input tokens.`)
    if (Option.isSome(record)) {
      const out = { kind, model, questionsVersion: version, answers: recorded, summary: summary(results) }
      yield* fs.writeFileString(record.value, `${JSON.stringify(out, null, 2)}\n`)
      yield* Console.log(`Answers recorded to ${record.value}`)
    }
  })
).pipe(Command.withDescription("Measure the Jev questions against the golden set (costs inference)"))
