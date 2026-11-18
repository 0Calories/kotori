import type { CautionExpectation } from "./goldenCautions.ts"

/**
 * How `kotori eval` scores the offline passes against their golden sets, and the bar each must
 * clear before its artifact is committed. Every bar weighs a wrong fill above a missing one: what
 * a pass leaves out, the page shows as the dictionary has it, while what it gets wrong is shown to
 * learners as fact, marked Kotori's.
 */

export interface Tally {
  readonly truePositive: number
  readonly falsePositive: number
  readonly falseNegative: number
  readonly trueNegative: number
}

export const tally = (results: ReadonlyArray<{ readonly expected: boolean; readonly got: boolean }>): Tally => ({
  truePositive: results.filter((r) => r.expected && r.got).length,
  falsePositive: results.filter((r) => !r.expected && r.got).length,
  falseNegative: results.filter((r) => r.expected && !r.got).length,
  trueNegative: results.filter((r) => !r.expected && !r.got).length
})

/** Of what was filled, how much was right; 1 when nothing was. */
export const precision = (t: Tally) =>
  t.truePositive + t.falsePositive === 0 ? 1 : t.truePositive / (t.truePositive + t.falsePositive)

/** Of what should be filled, how much was; 1 when nothing should be. */
export const recall = (t: Tally) =>
  t.truePositive + t.falseNegative === 0 ? 1 : t.truePositive / (t.truePositive + t.falseNegative)

/**
 * `ja-form`: a `form` chip on a plain word tells the learner it is stiff, so nearly every label
 * must be right (one wrong in ten at most). Missing a formal word leaves the dictionary's silence,
 * the page as it is today, so seven in ten found is enough to be worth shipping.
 */
export const FORM_BAR = { precision: 0.9, recall: 0.7 } as const

/**
 * Loans: a wrong true-loanword chip or a wrong wasei-eigo warning misleads in the very feature meant
 * to protect the learner, so each verdict must be right nine times in ten; finding six in ten of
 * each is enough, as an unjudged loan shows nothing.
 */
export const LOAN_BAR = { precision: 0.9, recall: 0.6 } as const

/**
 * Cautions: a needless caution is noise that teaches learners to skip them, so nine in
 * ten words that need none must get none; eight in ten words that need one must get the right
 * kind (and sense, and point). Any caution naming a sense by number fails the pass outright.
 */
export const CAUTION_BAR = { silent: 0.9, caught: 0.8 } as const

/** A caution as scored: its kind, text, sense position (null for the word) and compared word. */
export interface ScoredCaution {
  readonly kind: string
  readonly text: string
  readonly sense: number | null
  readonly about: string | null
}

/**
 * Whether a word's cautions meet its expectation: none written where none is wanted, or one of an
 * expected kind, on the expected sense (unless `anySense`, as for a draft, whose senses are its
 * own), that mentions one of the expected words.
 */
export const cautionVerdict = (
  expect: CautionExpectation,
  cautions: ReadonlyArray<ScoredCaution>,
  options: { readonly anySense?: boolean } = {}
): { readonly pass: boolean; readonly why: string } => {
  if (expect.none === true) {
    return cautions.length === 0
      ? { pass: true, why: "none, as wanted" }
      : {
          pass: false,
          why: `wanted none, wrote ${cautions.map((caution) => caution.kind).join(", ")}`
        }
  }
  if (cautions.length === 0) return { pass: false, why: `wanted ${expect.kinds.join("|")}, wrote none` }
  const ofKind = cautions.filter((caution) => expect.kinds.includes(caution.kind as never))
  if (ofKind.length === 0) {
    return {
      pass: false,
      why: `wanted ${expect.kinds.join("|")}, wrote ${cautions.map((caution) => caution.kind).join(", ")}`
    }
  }
  const onSense =
    options.anySense === true || expect.sense === undefined
      ? ofKind
      : ofKind.filter((caution) => caution.sense === expect.sense)
  if (onSense.length === 0) {
    return {
      pass: false,
      why: `wanted it on sense ${expect.sense! + 1}, wrote it on ${ofKind.map((caution) => (caution.sense === null ? "the word" : `sense ${caution.sense + 1}`)).join(", ")}`
    }
  }
  const mentions = expect.mentions
  if (mentions === undefined) return { pass: true, why: "as wanted" }
  const said = onSense.some((caution) =>
    mentions.some((needle) => `${caution.text} ${caution.about ?? ""}`.toLowerCase().includes(needle.toLowerCase()))
  )
  return said ? { pass: true, why: "as wanted" } : { pass: false, why: `never mentions ${mentions.join(" / ")}` }
}
