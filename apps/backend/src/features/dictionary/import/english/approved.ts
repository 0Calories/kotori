import { DraftCaution } from "@kotori/db"
import { Option, Schema } from "effect"
import { ConsolidatedWord, type FormOf, fromConsolidatedWord, type Word } from "./words.ts"

export const APPROVED_EN_FILE = "data/approved/en.jsonl"

export const ApprovedLine = Schema.Union([
  Schema.Struct({ entry: ConsolidatedWord, cautions: Schema.optional(Schema.Array(DraftCaution)) }),
  Schema.Struct({ alias: Schema.Struct({ text: Schema.String, base: Schema.String }) })
])
export type ApprovedLine = typeof ApprovedLine.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(ApprovedLine))
const encodeLine = Schema.encodeSync(Schema.fromJsonString(ApprovedLine))

export const serializeApprovedLine = (line: ApprovedLine): string => `${encodeLine(line)}\n`

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

export const skippedLines = (path: string, skipped: ReadonlyArray<number>): string => {
  const lines = skipped.length === 1 ? "line" : "lines"
  return `${path}: skipped ${skipped.length} ${lines} that don't decode (${lines} ${skipped.join(", ")})`
}
