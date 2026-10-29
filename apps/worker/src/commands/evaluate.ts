import {
  type EnglishAnswers,
  englishQuestions,
  GOLDEN_ENGLISH,
  GOLDEN_SENSES,
  goldenEnglishState,
  goldenState,
  interpretEnglish,
  interpretSense,
  Jev,
  type SenseAnswers,
  senseQuestions
} from "@kotori/nuance"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { readFile, writeFile } from "node:fs/promises"

/** Booleans are judged where the app judges them: the display threshold. */
const CAUTION_SHOWN = 0.6

interface Tally {
  n: number
  correct: number
  confidenceCorrect: Array<number>
  confidenceWrong: Array<number>
}

const tally = (
  tallies: Map<string, Tally>,
  dimension: string,
  correct: boolean,
  confidence: number | null,
  misses: Array<string>,
  miss: string
) => {
  const t = tallies.get(dimension) ?? { n: 0, correct: 0, confidenceCorrect: [], confidenceWrong: [] }
  t.n += 1
  if (correct) t.correct += 1
  else misses.push(miss)
  if (confidence !== null) (correct ? t.confidenceCorrect : t.confidenceWrong).push(confidence)
  tallies.set(dimension, t)
}

const mean = (xs: ReadonlyArray<number>) => (xs.length === 0 ? null : xs.reduce((sum, x) => sum + x, 0) / xs.length)

const report = (tallies: Map<string, Tally>, misses: Array<string>) =>
  Effect.gen(function* () {
    yield* Console.log("\ndimension            n  correct  accuracy  conf✓   conf✗")
    for (const [dimension, t] of tallies) {
      const accuracy = ((100 * t.correct) / t.n).toFixed(0).padStart(7)
      const ok = mean(t.confidenceCorrect)
      const bad = mean(t.confidenceWrong)
      yield* Console.log(
        `${dimension.padEnd(18)} ${String(t.n).padStart(3)}  ${String(t.correct).padStart(7)}  ${accuracy}%  ${
          ok === null ? "  —  " : ok.toFixed(2)
        }   ${bad === null ? "  —  " : bad.toFixed(2)}`
      )
    }
    if (misses.length > 0) {
      yield* Console.log("\nMisses:")
      for (const miss of misses) yield* Console.log(`  ${miss}`)
    }
  })

/**
 * Runs the current questions against the golden set and reports per-question accuracy
 * and confidence calibration. Costs inference: run deliberately, not in CI. With
 * --record, the raw answers are written as JSON so interpretation changes can be
 * evaluated offline against the same answers.
 */
export const evaluate = Command.make(
  "eval",
  {
    kind: Argument.Literals("kind", ["nuance", "english"]).pipe(
      Argument.withDescription("nuance (the Japanese questions) or english (the English-side questions)")
    ),
    record: Flag.String("record").pipe(
      Flag.withDescription("Write the raw answers to this JSON file, for offline reinterpretation"),
      Flag.optional
    ),
    from: Flag.String("from").pipe(
      Flag.withDescription("Reinterpret previously recorded answers from this JSON file instead of calling Jev"),
      Flag.optional
    ),
    concurrency: Flag.Int("concurrency").pipe(Flag.withDescription("Words judged in parallel"), Flag.withDefault(4))
  },
  Effect.fn(function* ({ kind, record, from, concurrency }) {
    const jev = yield* Jev
    const recordings = Option.isSome(from)
      ? ((yield* Effect.promise(() => readFile(from.value, "utf8").then(JSON.parse))) as Record<string, unknown>)
      : null
    if (recordings === null && !jev.configured) {
      return yield* Console.error("TYPESAFE_API_KEY is not set; eval needs Jev (or --from a recording).")
    }
    /** Fresh answers from Jev, or the recorded ones when reinterpreting offline. */
    const answersFor = (key: string, state: object, questions: Parameters<typeof jev.ask>[1]) =>
      recordings === null
        ? Effect.map(jev.ask(state as never, questions), (result) => result.answers as unknown)
        : Effect.succeed(recordings[key])

    const tallies = new Map<string, Tally>()
    const misses: Array<string> = []
    const recorded: Record<string, unknown> = {}

    if (kind === "nuance") {
      yield* Console.log(`Judging ${GOLDEN_SENSES.length} golden senses with ${jev.model}…`)
      yield* Effect.forEach(
        GOLDEN_SENSES,
        (golden) =>
          Effect.gen(function* () {
            const key = `${golden.word}:${golden.meaning}`
            const answers = yield* answersFor(key, goldenState(golden), senseQuestions)
            if (answers === undefined) return
            recorded[key] = answers
            const nuance = interpretSense(answers as SenseAnswers, [])
            const expect = golden.expect
            const seen = (dimension: string, got: string, confidence: number, want: ReadonlyArray<string>) =>
              tally(
                tallies,
                dimension,
                want.includes(got),
                confidence,
                misses,
                `${golden.word} ${dimension}: got ${got}, wanted ${want.join("|")}`
              )
            if (expect.formality)
              seen("formality", nuance.formality.value, nuance.formality.confidence, expect.formality)
            if (expect.medium) seen("medium", nuance.medium.value, nuance.medium.confidence, expect.medium)
            if (expect.keigo) seen("keigo", nuance.keigo.value, nuance.keigo.confidence, [expect.keigo])
            if (expect.gender) seen("gender", nuance.gender.value, nuance.gender.confidence, [expect.gender])
            if (expect.age) seen("age", nuance.age.value, nuance.age.confidence, [expect.age])
            if (expect.currency) seen("currency", nuance.currency.value, nuance.currency.confidence, [expect.currency])
            if (expect.connotation) {
              seen("connotation", nuance.connotation.value, nuance.connotation.confidence, [expect.connotation])
            }
            if (expect.registerShape && nuance.registerShape) {
              seen("registerShape", nuance.registerShape.value, nuance.registerShape.confidence, [expect.registerShape])
            }
            const caution = (dimension: string, probability: number, want: boolean) =>
              tally(
                tallies,
                dimension,
                probability >= CAUTION_SHOWN === want,
                probability,
                misses,
                `${golden.word} ${dimension}: p=${probability.toFixed(2)}, wanted ${want ? ">=" : "<"} ${CAUTION_SHOWN}`
              )
            if (expect.rudeToSuperiors !== undefined) {
              caution("rudeToSuperiors", nuance.cautions.rudeToSuperiors, expect.rudeToSuperiors)
            }
            if (expect.stiffWithFriends !== undefined) {
              caution("stiffWithFriends", nuance.cautions.stiffWithFriends, expect.stiffWithFriends)
            }
            if (expect.slang !== undefined) caution("slang", nuance.cautions.slang, expect.slang)
          }),
        { concurrency, discard: true }
      )
    } else {
      yield* Console.log(`Judging ${GOLDEN_ENGLISH.length} golden English words with ${jev.model}…`)
      yield* Effect.forEach(
        GOLDEN_ENGLISH,
        (golden) =>
          Effect.gen(function* () {
            const key = `${golden.word}:${golden.meaning}`
            const answers = yield* answersFor(key, goldenEnglishState(golden), englishQuestions)
            if (answers === undefined) return
            recorded[key] = answers
            const english = interpretEnglish(answers as EnglishAnswers)
            for (const dimension of ["variety", "strength", "currency", "register", "loan"] as const) {
              const want = golden.expect[dimension]
              if (want === undefined) continue
              const got = english[dimension]
              tally(
                tallies,
                dimension,
                got.value === want,
                got.confidence,
                misses,
                `${golden.word} ${dimension}: got ${got.value}, wanted ${want}`
              )
            }
          }),
        { concurrency, discard: true }
      )
    }

    yield* report(tallies, misses)
    if (Option.isSome(record)) {
      yield* Effect.promise(() => writeFile(record.value, `${JSON.stringify(recorded, null, 2)}\n`))
      yield* Console.log(`\nAnswers recorded to ${record.value}`)
    }
  })
).pipe(Command.withDescription("Measure the Jev questions against the golden set (costs inference)"))
