import {
  GOLDEN_ASKS,
  interpretTriage,
  Jev,
  type JevError,
  orderChecks,
  TRIAGE_VERSION,
  triageRequest
} from "@kotori/ai"
import { normalizeAsk } from "@kotori/language"
import * as Sentry from "@sentry/effect/server"
import type { EntryType, Question } from "@typesafe-ai/sdk"
import { Console, Effect, FileSystem, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { turnAway } from "../features/asks/garbage.ts"

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

/** One question's results: how often it was right, and how its Choices held up with the options reversed. */
interface Row {
  readonly tally: Tally
  readonly order: Order
}

const makeResults = () => {
  const rows = new Map<string, Row>()
  const misses: Array<string> = []
  const failures: Array<string> = []
  const row = (question: string) => {
    const found = rows.get(question)
    if (found !== undefined) return found
    const created = {
      tally: { n: 0, correct: 0, confidenceCorrect: [], confidenceWrong: [] },
      order: { n: 0, flipped: 0, towardFirst: 0 }
    }
    rows.set(question, created)
    return created
  }
  return {
    rows,
    misses,
    failures,
    judged: (question: string, correct: boolean, confidence: number | null, miss: string) => {
      const tally = row(question).tally
      tally.n += 1
      if (correct) tally.correct += 1
      if (confidence !== null) (correct ? tally.confidenceCorrect : tally.confidenceWrong).push(confidence)
      if (!correct) misses.push(miss)
    },
    order: (question: string, check: { readonly flipped: boolean; readonly towardFirst: boolean }) => {
      const order = row(question).order
      order.n += 1
      if (check.flipped) order.flipped += 1
      if (check.towardFirst) order.towardFirst += 1
    }
  }
}

type Results = ReturnType<typeof makeResults>

const mean = (xs: ReadonlyArray<number>) => (xs.length === 0 ? null : xs.reduce((sum, x) => sum + x, 0) / xs.length)
const percent = (part: number, whole: number) =>
  whole === 0 ? "   —" : `${((100 * part) / whole).toFixed(0)}%`.padStart(4)
const two = (x: number | null) => (x === null ? "  — " : x.toFixed(2))

const report = (results: Results) =>
  Effect.gen(function* () {
    yield* Console.log(
      [
        "",
        "                                              Options reversed",
        "question       n   acc  conf✓  conf✗      n  flips  to first"
      ].join("\n")
    )
    for (const [question, { tally, order }] of results.rows) {
      yield* Console.log(
        [
          question.padEnd(10),
          `${String(tally.n).padStart(4)}  ${percent(tally.correct, tally.n)}`,
          `${two(mean(tally.confidenceCorrect))}   ${two(mean(tally.confidenceWrong))}`,
          order.n === 0
            ? ""
            : `   ${String(order.n).padStart(4)}  ${percent(order.flipped, order.n)}  ${String(order.towardFirst).padStart(5)}`
        ].join("  ")
      )
    }
    if (results.misses.length > 0) {
      yield* Console.log("\nMisses:")
      for (const miss of results.misses) yield* Console.log(`  ${miss}`)
    }
    if (results.failures.length > 0) {
      yield* Console.log("\nFailed requests:")
      for (const failure of results.failures) yield* Console.log(`  ${failure}`)
    }
  })

const summary = (results: Results) =>
  Object.fromEntries(
    [...results.rows].map(([question, { tally, order }]) => [
      question,
      {
        n: tally.n,
        correct: tally.correct,
        confidence: mean([...tally.confidenceCorrect, ...tally.confidenceWrong]),
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

type Answers = Readonly<Record<string, unknown>>

/** What each eval measures, and the version of the questions it asks. */
const KINDS = {
  asks: {
    version: TRIAGE_VERSION,
    about: "Ask Kotori queries: Jev's routing of those the free checks let through"
  }
} as const
type Kind = keyof typeof KINDS
const kinds = Object.keys(KINDS) as ReadonlyArray<Kind>

/**
 * Runs the current questions against their golden set and reports accuracy, confidence and
 * option-order agreement, with every request built by the production builders. Costs inference:
 * run deliberately, not in CI. With --record, the raw answers are written as JSON so
 * interpretation changes can be evaluated offline against the same answers (--from).
 */
export const evaluate = Command.make(
  "eval",
  {
    kind: Argument.Literals("kind", kinds).pipe(
      Argument.withDescription(kinds.map((kind) => `${kind} (${KINDS[kind].about})`).join(", "))
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

    const results = makeResults()
    const recorded: Record<string, Answers> = {}
    let inputTokens = 0

    /** Fresh answers from Jev, or the recorded ones; a failed request is reported and skipped. */
    const answersFor = (
      key: string,
      state: EntryType,
      questions: Readonly<Record<string, Question>>
    ): Effect.Effect<Answers | undefined> => {
      const answers: Effect.Effect<Answers | undefined, JevError> =
        recording === null
          ? Effect.sync(() => Sentry.setConversationId(key)).pipe(
              Effect.andThen(jev.ask(state, { ...questions })),
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
    const version = recording?.questionsVersion ?? KINDS[kind].version

    const run: Record<Kind, () => Effect.Effect<void>> = {
      asks: () =>
        Effect.gen(function* () {
          yield* Console.log(`Routing ${GOLDEN_ASKS.length} golden asks with ${model}, triage version ${version}…`)
          // Jev sees what production gives it: the query normalized, and only if the free checks let it by.
          const turnedAway: Array<string> = []
          const reaching = GOLDEN_ASKS.flatMap((golden) => {
            const query = normalizeAsk(golden.query, golden.language)
            const refusal = turnAway(query, golden.language)
            if (refusal === null) return [{ ...golden, query }]
            // A lookup turned away is a real question lost for free; anything else was spared a Jev call.
            turnedAway.push(
              `${golden.expect === "lookup" ? "LOST " : ""}${golden.language} "${golden.query}": ${refusal}, wanted ${golden.expect}`
            )
            return []
          })
          let undecided = 0
          yield* Effect.forEach(
            reaching,
            (golden) =>
              Effect.gen(function* () {
                const request = triageRequest(golden.query, golden.language)
                const answers = yield* answersFor(
                  `${golden.language}:${golden.query}`,
                  request.state,
                  request.questions
                )
                if (answers === undefined) return
                for (const check of orderChecks(request.questions, answers)) results.order(check.name, check)
                const triage = interpretTriage(answers)
                if (!triage.decided) undecided++
                results.judged(
                  "route",
                  triage.route === golden.expect,
                  triage.probabilities[triage.route],
                  `${golden.language} "${golden.query}": routed ${triage.route}${triage.decided ? "" : " (undecided, fell open)"}, wanted ${golden.expect}`
                )
              }),
            { concurrency, discard: true }
          )
          yield* Console.log(`${undecided} of ${reaching.length} fell open to Claude for want of a sure route.`)
          if (turnedAway.length > 0) {
            yield* Console.log(`\nTurned away before Jev (${turnedAway.length}, not scored):`)
            for (const line of turnedAway) yield* Console.log(`  ${line}`)
          }
        })
    }
    yield* run[kind]()

    yield* report(results)
    if (recording === null) yield* Console.log(`\n${inputTokens.toLocaleString()} input tokens.`)
    if (Option.isSome(record)) {
      const out = { kind, model, questionsVersion: version, answers: recorded, summary: summary(results) }
      yield* fs.writeFileString(record.value, `${JSON.stringify(out, null, 2)}\n`)
      yield* Console.log(`Answers recorded to ${record.value}`)
    }
  })
).pipe(Command.withDescription("Measure Jev's questions against their golden set (costs inference)"))
