import { CAUTION_KINDS, type CautionKind, type Language, MAX_CAUTIONS } from "@kotori/contracts"
import { Schema } from "effect"

/**
 * The one rulebook for cautions Claude writes, wherever it writes them: the dictionary pass
 * (`CautionWriter`) and Ask Kotori drafts (`Lexicographer`, checked in the backend). Both ask for
 * `CautionOutput` and keep only what `checkCautions` keeps, so a draft and a dictionary word are
 * held to the same rules, as `cautionGuide.ts` tells Claude they are.
 */

/** A caution as Claude writes it. */
export const CautionOutput = Schema.Struct({
  kind: Schema.String,
  text: Schema.String,
  /** The sense it is about, numbered from 1 as listed; null for the whole word. */
  sense: Schema.NullOr(Schema.Int),
  about: Schema.NullOr(Schema.String)
})
export type CautionOutput = typeof CautionOutput.Type

/** A caution as checked: a valid kind, a sense that exists (by position), non-empty text. */
export interface WrittenCaution {
  readonly kind: CautionKind
  readonly text: string
  /** The sense's position in the word's kept senses; null for the whole word. */
  readonly sense: number | null
  readonly about: string | null
}

/** Why a caution Claude wrote was dropped, for the eval to report. */
export interface DroppedCaution {
  readonly reason: "kind" | "sense" | "empty" | "numbered" | "cap"
  readonly caution: CautionOutput
}

/** What checking a word's cautions needs to know about the word. */
export interface CautionRules {
  /** The word's language, which decides the kinds allowed (`CAUTION_KINDS`). */
  readonly language: Language
  /** The word as written; an `about` that only repeats it is cleared. */
  readonly headword: string
  /**
   * Where a sense, numbered from 1 as Claude was shown it, lands among the senses kept for the
   * word: its position, or null when no kept sense is that one.
   */
  readonly placeSense: (sense: number) => number | null
}

/** `placeSense` for senses kept as listed: sense n is position n − 1 of `count`. */
export const listedSenses =
  (count: number) =>
  (sense: number): number | null =>
    sense >= 1 && sense <= count ? sense - 1 : null

const NUMBERED =
  /\bsense\s*\d|\bmeaning\s*#?\d|#\d\b|（\d）|\(\d\)|[0-9０-９]+\s*番目?の(?:意味|語義)|語義\s*[0-9０-９]|意味\s*[0-9０-９]/i

/** A sense named by its number in the text ("sense 2", "(2)", "2番目の意味"), which breaks if senses move. */
export const namesSenseByNumber = (text: string) => NUMBERED.test(text)

/**
 * Claude's cautions for one word, checked: dropped when empty, of a kind the language can't have,
 * about a sense that isn't kept, naming a sense by its number, or past `MAX_CAUTIONS`; an `about`
 * that repeats the headword is cleared. See `WrittenCaution`.
 */
export const checkCautions = (
  written: ReadonlyArray<CautionOutput>,
  rules: CautionRules
): {
  readonly cautions: ReadonlyArray<WrittenCaution>
  readonly dropped: ReadonlyArray<DroppedCaution>
} => {
  const allowed = new Set<string>(CAUTION_KINDS[rules.language])
  const cautions: Array<WrittenCaution> = []
  const dropped: Array<DroppedCaution> = []
  for (const caution of written) {
    const text = caution.text.trim()
    const sense = caution.sense === null ? null : rules.placeSense(caution.sense)
    const reason =
      text.length === 0
        ? "empty"
        : !allowed.has(caution.kind)
          ? "kind"
          : caution.sense !== null && sense === null
            ? "sense"
            : namesSenseByNumber(text)
              ? "numbered"
              : cautions.length >= MAX_CAUTIONS
                ? "cap"
                : null
    if (reason !== null) {
      dropped.push({ reason, caution })
      continue
    }
    const about = caution.about?.trim() ?? ""
    cautions.push({
      kind: caution.kind as CautionKind,
      text,
      sense,
      about: about.length > 0 && about !== rules.headword ? about : null
    })
  }
  return { cautions, dropped }
}
