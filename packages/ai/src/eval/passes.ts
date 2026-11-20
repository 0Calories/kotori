import type { CautionExpectation } from "./goldenCautions.ts"

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

export const precision = (t: Tally) =>
  t.truePositive + t.falsePositive === 0 ? 1 : t.truePositive / (t.truePositive + t.falsePositive)

export const recall = (t: Tally) =>
  t.truePositive + t.falseNegative === 0 ? 1 : t.truePositive / (t.truePositive + t.falseNegative)

// Thresholds weight precision above recall because a missing label or caution leaves the entry unchanged, whereas a false positive states wrong usage as fact.
export const FORM_BAR = { precision: 0.9, recall: 0.7 } as const
export const LOAN_BAR = { precision: 0.9, recall: 0.6 } as const
export const CAUTION_BAR = { silent: 0.9, caught: 0.8 } as const

export interface ScoredCaution {
  readonly kind: string
  readonly text: string
  readonly sense: number | null
  readonly about: string | null
}

/** `anySense` skips sense-index matching for drafted entries, which choose their own sense order. */
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
