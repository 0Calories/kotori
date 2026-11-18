import type { Label, LabelCode, SimilarDifference } from "@kotori/contracts"

export const senseLabels = (
  labels: ReadonlyArray<ReadonlyArray<Label>>
): { readonly word: ReadonlyArray<Label>; readonly senses: ReadonlyArray<ReadonlyArray<Label>> } => {
  const key = (label: Label) => `${label.code}\u0000${label.source}`
  const [first = [], ...rest] = labels
  const shared = new Set(
    first.map(key).filter((own) => rest.every((other) => other.some((label) => key(label) === own)))
  )
  return {
    word: first.filter((label) => shared.has(key(label))),
    senses: labels.map((own) => own.filter((label) => !shared.has(key(label))))
  }
}

const CASUAL: ReadonlyArray<LabelCode> = ["vulg", "X", "derog", "sl", "net-sl", "m-sl", "col", "fam"]
const FORMAL: ReadonlyArray<LabelCode> = ["form", "pol"]
const OLD: ReadonlyArray<LabelCode> = ["arch", "obs", "dated"]
const MARKED: ReadonlyArray<LabelCode> = ["hon", "hum", ...FORMAL, ...CASUAL, "male", "fem"]

const has = (codes: ReadonlySet<LabelCode>, wanted: ReadonlyArray<LabelCode>) => wanted.some((code) => codes.has(code))

export const differenceOf = (own: ReadonlyArray<LabelCode>, other: ReadonlyArray<LabelCode>): SimilarDifference => {
  const mine = new Set(own)
  const theirs = new Set(other)
  const gains = (wanted: ReadonlyArray<LabelCode>) => has(theirs, wanted) && !has(mine, wanted)
  if (gains(["hon"])) return "respectful"
  if (gains(["hum"])) return "humble"
  if (gains(CASUAL)) return "more_casual"
  if (gains(FORMAL)) return "more_formal"
  // Losing a register or gender label makes the other word unmarked ("plain"), not the opposite register (お疲れ様 is plain next to ご苦労様, not casual).
  if (has(mine, MARKED) && !has(theirs, MARKED)) return "plain"
  if (gains(["male"])) return "masculine"
  if (gains(["fem"])) return "feminine"
  if (gains(["en-US"])) return "american"
  if (gains(["en-GB"])) return "british"
  if (gains(OLD)) return "older"
  return "similar"
}

export interface Candidate {
  readonly sense: number
  readonly entryId: number
  readonly otherSense: number | null
  readonly via: "xref" | "gloss"
}

export const pickCandidates = (
  entryId: number,
  candidates: ReadonlyArray<Candidate>,
  perSense: number
): Array<Candidate> => {
  const seen = new Set<number>([entryId])
  const count = new Map<number, number>()
  const picked: Array<Candidate> = []
  const ordered = candidates.toSorted((a, b) => a.sense - b.sense || (a.via === b.via ? 0 : a.via === "xref" ? -1 : 1))
  for (const candidate of ordered) {
    if (seen.has(candidate.entryId) || (count.get(candidate.sense) ?? 0) >= perSense) continue
    seen.add(candidate.entryId)
    count.set(candidate.sense, (count.get(candidate.sense) ?? 0) + 1)
    picked.push(candidate)
  }
  return picked
}
