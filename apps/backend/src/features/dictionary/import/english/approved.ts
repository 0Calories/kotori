import { DraftCaution } from "@kotori/db"
import { Option, Schema } from "effect"
import { ConsolidatedWord, type FormOf, fromConsolidatedWord, type Word } from "./words.ts"

/**
 * `data/approved/en.jsonl`: English entries and aliases the admin approved out of Ask Kotori
 * proposals (`kotori proposals approve`), committed so a reseed — or a fresh database — keeps
 * them. One JSON object per line: an entry in the curated format, or an alias that adds a way an
 * existing word is written ("it be like it be" → "it is what it is"). The import reads it as a
 * curated source; the CLI appends to it.
 */
export const APPROVED_EN_FILE = "data/approved/en.jsonl"

export const ApprovedLine = Schema.Union([
  Schema.Struct({ entry: ConsolidatedWord, cautions: Schema.optional(Schema.Array(DraftCaution)) }),
  Schema.Struct({ alias: Schema.Struct({ text: Schema.String, base: Schema.String }) })
])
export type ApprovedLine = typeof ApprovedLine.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(ApprovedLine))
const encodeLine = Schema.encodeSync(Schema.fromJsonString(ApprovedLine))

export const serializeApprovedLine = (line: ApprovedLine): string => `${encodeLine(line)}\n`

/**
 * The approved entries and aliases in the file's lines. Lines that don't parse are left out, and
 * `skipped` names them by number (from 1) for the import to report.
 */
export const parseApproved = (
  lines: Iterable<string>
): { readonly words: Array<Word>; readonly formsOf: Array<FormOf>; readonly skipped: Array<number> } => {
  const words: Array<Word> = []
  const formsOf: Array<FormOf> = []
  const skipped: Array<number> = []
  let number = 0
  for (const line of lines) {
    number++
    if (line.trim().length === 0) continue
    const decoded = decodeLine(line)
    if (Option.isNone(decoded)) {
      skipped.push(number)
      continue
    }
    if ("entry" in decoded.value) {
      words.push({
        ...fromConsolidatedWord(decoded.value.entry),
        source: "kotori",
        cautions: decoded.value.cautions ?? []
      })
    } else formsOf.push({ text: decoded.value.alias.text, base: decoded.value.alias.base, tags: [] })
  }
  return { words, formsOf, skipped }
}

/** The warning for an approved file's lines that don't decode, which an import leaves out. */
export const skippedLines = (path: string, skipped: ReadonlyArray<number>): string => {
  const lines = skipped.length === 1 ? "line" : "lines"
  return `${path}: skipped ${skipped.length} ${lines} that don't decode (${lines} ${skipped.join(", ")})`
}
