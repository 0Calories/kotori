import {
  CAUTION_BAR,
  CAUTION_BATCH,
  type CautionExpectation,
  CautionWriter,
  cautionVerdict,
  type EntryCautions,
  FORM_BAR,
  FORMAL_LABEL_SURE,
  formalLabelProbabilities,
  formalLabelRequest,
  GOLDEN_CAUTIONS,
  GOLDEN_DRAFTS,
  GOLDEN_FORMAL_LABELS,
  GOLDEN_LOANS,
  type GoldenCaution,
  interpretLoan,
  Lexicographer,
  LOAN_BAR,
  LOAN_IS,
  LOAN_SURE,
  loanRequest,
  namesSenseByNumber,
  orderChecks,
  precision,
  recall,
  type ScoredCaution,
  tally
} from "@kotori/ai"
import type { Language } from "@kotori/contracts"
import type { EntryType, Question } from "@typesafe-ai/sdk"
import { Console, Effect } from "effect"
import { chunks } from "../db/chunks.ts"
import { checkDraft } from "../features/asks/draft.ts"

/**
 * The offline passes' evals (`kotori eval ja-form|loans|cautions|drafts`): each pass run over its
 * golden set with the production request builders, scored against the bar that gates committing
 * its artifact (`passes.ts` in `@kotori/ai` says why each bar sits where it does).
 */

type Answers = Readonly<Record<string, unknown>>

export interface EvalContext {
  /** Jev's answers for `key` (fresh, or recorded), or undefined when the request failed. */
  readonly ask: (
    key: string,
    state: EntryType,
    questions: Readonly<Record<string, Question>>
  ) => Effect.Effect<Answers | undefined>
  /** `run`'s result for `key` (fresh, or recorded), or undefined when it failed. */
  readonly remember: <A extends Answers>(key: string, run: Effect.Effect<A, unknown>) => Effect.Effect<A | undefined>
  readonly concurrency: number
}

const pct = (x: number) => `${(100 * x).toFixed(0)}%`
const verdict = (pass: boolean) => (pass ? "PASS" : "FAIL")
const flag = (judgement: boolean) => (judgement ? " [judgement]" : "")

/** `ja-form`: precision and recall of the `form` label over the golden senses, at several cut-offs. */
export const evalFormalLabels = (context: EvalContext) =>
  Effect.gen(function* () {
    yield* Console.log(`Judging ${GOLDEN_FORMAL_LABELS.length} golden senses…`)
    const probabilities: Array<number | null> = []
    for (const [index, batch] of chunks(GOLDEN_FORMAL_LABELS, 25).entries()) {
      const request = formalLabelRequest(batch.map((golden) => ({ word: golden.word, sense: golden.sense })))
      const answers = yield* context.ask(`form:${index}`, request.state, request.questions)
      probabilities.push(
        ...(answers === undefined ? batch.map(() => null) : formalLabelProbabilities(answers, batch.length))
      )
    }
    const scored = GOLDEN_FORMAL_LABELS.flatMap((golden, index) => {
      const p = probabilities[index]
      return p === null || p === undefined ? [] : [{ golden, p }]
    })
    yield* Console.log("\ncut-off  precision  recall   (fills at p >= cut-off)")
    for (const cut of [0.5, 0.6, FORMAL_LABEL_SURE, 0.8, 0.9]) {
      const t = tally(scored.map(({ golden, p }) => ({ expected: golden.formal, got: p >= cut })))
      yield* Console.log(
        `  ${cut.toFixed(2)}    ${pct(precision(t)).padStart(5)}    ${pct(recall(t)).padStart(5)}${cut === FORMAL_LABEL_SURE ? "  ← used" : ""}`
      )
    }
    const used = tally(scored.map(({ golden, p }) => ({ expected: golden.formal, got: p >= FORMAL_LABEL_SURE })))
    yield* Console.log("\nEvery sense (✗ = wrong at the cut-off used):")
    for (const { golden, p } of scored) {
      const right = golden.formal === p >= FORMAL_LABEL_SURE
      yield* Console.log(
        `  ${right ? "✓" : "✗"} ${golden.word.headword} (${golden.word.senses[golden.sense]!.glosses[0]}): p=${p.toFixed(2)}, wanted ${golden.formal ? "form" : "plain"}${flag(golden.judgement)}`
      )
    }
    const unanswered = GOLDEN_FORMAL_LABELS.length - scored.length
    if (unanswered > 0) yield* Console.log(`\n${unanswered} senses unanswered (failed requests).`)
    const pass = unanswered === 0 && precision(used) >= FORM_BAR.precision && recall(used) >= FORM_BAR.recall
    yield* Console.log(
      `\n${verdict(pass)}: precision ${pct(precision(used))} (bar ${pct(FORM_BAR.precision)}), recall ${pct(recall(used))} (bar ${pct(FORM_BAR.recall)}) at p >= ${FORMAL_LABEL_SURE}.`
    )
  })

/** Loans: each verdict's precision and recall, false candidates told apart, and option-order flips. */
export const evalLoans = (context: EvalContext) =>
  Effect.gen(function* () {
    yield* Console.log(`Judging ${GOLDEN_LOANS.length} golden English words' loans…`)
    const rows: Array<{ readonly expected: string; readonly got: string; readonly line: string }> = []
    let flips = 0
    let orders = 0
    yield* Effect.forEach(
      GOLDEN_LOANS,
      (golden) =>
        Effect.gen(function* () {
          const request = loanRequest(golden.english, golden.candidates)
          const answers = yield* context.ask(`loan:${golden.english}`, request.state, request.questions)
          if (answers === undefined) return
          for (const check of orderChecks(request.questions, answers)) {
            orders++
            if (check.flipped) flips++
          }
          const reading = interpretLoan(answers, golden.candidates)
          const right = reading.katakana === (golden.katakana ?? reading.katakana)
          const got = reading.meaning === null || !right ? "none" : reading.meaning
          const expected = golden.expect === "no_loan" ? "none" : golden.expect
          const meanings =
            reading.meanings === null
              ? ""
              : ` (same ${reading.meanings.same.toFixed(2)}, divergent ${reading.meanings.divergent.toFixed(2)}, not English ${reading.meanings.not_english.toFixed(2)})`
          rows.push({
            expected,
            got,
            line: `${golden.english}: ${reading.katakana ?? "no loan"} → ${reading.meaning ?? "no verdict"}${meanings}, wanted ${golden.expect}${golden.katakana ? ` (${golden.katakana})` : ""}${flag(golden.judgement)}`
          })
        }),
      { concurrency: context.concurrency, discard: true }
    )
    yield* Console.log(
      `\nA candidate is the loan at p >= ${LOAN_IS} (a JMdict source is certain); a verdict is written at p >= ${LOAN_SURE}.`
    )
    yield* Console.log("\nEvery word:")
    for (const row of rows) yield* Console.log(`  ${row.expected === row.got ? "✓" : "✗"} ${row.line}`)
    let pass = rows.length === GOLDEN_LOANS.length
    yield* Console.log("")
    for (const meaning of ["wasei_eigo", "true_loanword"] as const) {
      const t = tally(rows.map((row) => ({ expected: row.expected === meaning, got: row.got === meaning })))
      const ok = precision(t) >= LOAN_BAR.precision && recall(t) >= LOAN_BAR.recall
      pass &&= ok
      yield* Console.log(
        `${meaning.padEnd(13)} precision ${pct(precision(t)).padStart(4)}, recall ${pct(recall(t)).padStart(4)}  (${t.truePositive} right, ${t.falsePositive} wrong, ${t.falseNegative} missed)`
      )
    }
    if (orders > 0) yield* Console.log(`Option order: ${flips} of ${orders} meaning Choices flipped when reversed.`)
    if (rows.length < GOLDEN_LOANS.length) yield* Console.log(`${GOLDEN_LOANS.length - rows.length} words unanswered.`)
    yield* Console.log(
      `\n${verdict(pass)}: each verdict needs precision ${pct(LOAN_BAR.precision)} and recall ${pct(LOAN_BAR.recall)}.`
    )
  })

/** One word's cautions as scored, with the text for a person to read. */
interface CautionRow {
  readonly language: Language
  readonly headword: string
  readonly expect: CautionExpectation
  readonly judgement: boolean
  readonly cautions: ReadonlyArray<ScoredCaution>
  readonly note: string | null
  readonly anySense: boolean
  readonly senseGloss: (sense: number | null) => string
}

/** Per-item verdicts, the silent and caught rates, and the bar. */
const reportCautions = (rows: ReadonlyArray<CautionRow>, total: number) =>
  Effect.gen(function* () {
    let silent = 0
    let none = 0
    let caught = 0
    let needed = 0
    let numbered = 0
    for (const row of rows) {
      const result = cautionVerdict(row.expect, row.cautions, { anySense: row.anySense })
      if (row.expect.none === true) {
        none++
        if (result.pass) silent++
      } else {
        needed++
        if (result.pass) caught++
      }
      yield* Console.log(
        `  ${result.pass ? "✓" : "✗"} ${row.language} ${row.headword}: ${result.why}${row.note === null ? "" : `; ${row.note}`}${flag(row.judgement)}`
      )
      for (const caution of row.cautions) {
        if (namesSenseByNumber(caution.text)) numbered++
        yield* Console.log(
          `      [${caution.kind}, ${row.senseGloss(caution.sense)}${caution.about === null ? "" : `, about ${caution.about}`}] ${caution.text}`
        )
      }
    }
    const silentRate = none === 0 ? 1 : silent / none
    const caughtRate = needed === 0 ? 1 : caught / needed
    const pass =
      rows.length === total && numbered === 0 && silentRate >= CAUTION_BAR.silent && caughtRate >= CAUTION_BAR.caught
    yield* Console.log(
      `\nSilent where none is needed: ${silent}/${none} (${pct(silentRate)}, bar ${pct(CAUTION_BAR.silent)}). ` +
        `Caught where one is: ${caught}/${needed} (${pct(caughtRate)}, bar ${pct(CAUTION_BAR.caught)}). ` +
        `Naming a sense by number: ${numbered}.` +
        (rows.length < total ? ` ${total - rows.length} words unanswered.` : "")
    )
    yield* Console.log(verdict(pass))
  })

const glossOf = (golden: GoldenCaution) => (sense: number | null) =>
  sense === null ? "word" : `“${golden.word.senses[sense]?.glosses[0] ?? `sense ${sense + 1}`}”`

/** Cautions: the writer over the golden words, in production's batches, per language. */
export const evalCautions = (context: EvalContext) =>
  Effect.gen(function* () {
    const writer = yield* CautionWriter
    yield* Console.log(`Writing cautions for ${GOLDEN_CAUTIONS.length} golden words with ${writer.model}…\n`)
    const rows: Array<CautionRow> = []
    for (const language of ["ja", "en"] as const) {
      const golden = GOLDEN_CAUTIONS.filter((item) => item.language === language)
      const batches = chunks(golden, CAUTION_BATCH)
      yield* Effect.forEach(
        batches.entries(),
        ([index, batch]) =>
          Effect.gen(function* () {
            const results = yield* context.remember(
              `cautions:${language}:${index}`,
              writer
                .write(
                  batch.map((item) => item.word),
                  language
                )
                .pipe(Effect.map((written) => ({ results: written })))
            )
            if (results === undefined) return
            batch.forEach((item, position) => {
              const result: EntryCautions | undefined = results.results[position]
              if (result === undefined || result.missing) return
              const dropped = result.dropped.map((drop) => `dropped a ${drop.caution.kind} (${drop.reason})`)
              rows.push({
                language,
                headword: item.word.headword,
                expect: item.expect,
                judgement: item.judgement,
                cautions: result.cautions,
                note: dropped.length > 0 ? dropped.join(", ") : null,
                anySense: false,
                senseGloss: glossOf(item)
              })
            })
          }),
        { concurrency: context.concurrency, discard: true }
      )
    }
    yield* reportCautions(
      rows.sort((a, b) => a.language.localeCompare(b.language)),
      GOLDEN_CAUTIONS.length
    )
  })

/** Drafts: the Lexicographer's cautions on golden Ask Kotori queries, as approval would store them. */
export const evalDrafts = (context: EvalContext) =>
  Effect.gen(function* () {
    const lexicographer = yield* Lexicographer
    const queries = [
      ...GOLDEN_CAUTIONS.filter((item) => item.draft === true).map((item) => ({
        language: item.language,
        query: item.word.headword,
        expect: item.expect,
        judgement: item.judgement
      })),
      ...GOLDEN_DRAFTS
    ]
    yield* Console.log(`Drafting ${queries.length} golden Ask Kotori queries…\n`)
    const rows: Array<CautionRow> = []
    yield* Effect.forEach(
      queries,
      (item) =>
        Effect.gen(function* () {
          const output = yield* context.remember(
            `draft:${item.language}:${item.query}`,
            lexicographer.draft({ query: item.query, language: item.language, candidates: [] })
          )
          if (output === undefined) return
          const draft =
            output.verdict === "entry" && output.entry !== null ? checkDraft(output.entry, item.language) : null
          rows.push({
            language: item.language,
            headword: item.query,
            expect: item.expect,
            judgement: item.judgement,
            cautions: draft?.cautions ?? [],
            note:
              draft === null
                ? `not drafted (${output.verdict}${output.reason ? `: ${output.reason}` : ""})`
                : `labels ${[...new Set(draft.senses.flatMap((sense) => sense.labels))].join(", ") || "none"}`,
            anySense: true,
            senseGloss: (sense) => (sense === null ? "word" : `“${draft?.senses[sense]?.glosses[0] ?? sense + 1}”`)
          })
        }),
      { concurrency: context.concurrency, discard: true }
    )
    yield* reportCautions(
      rows.sort((a, b) => a.language.localeCompare(b.language)),
      queries.length
    )
  })
