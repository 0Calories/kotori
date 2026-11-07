import { LoanLinkMeaning, PitfallKind } from "@kotori/db"
import { Effect, FileSystem, Option, Schema } from "effect"
import { resolveFromRoot } from "../../../runtime/Paths.ts"

/**
 * The offline passes' artifacts: what `kotori judge` wrote, reviewed and committed, and what the
 * import reads (`apply.ts`). JSON lines: a header naming the pass, the model and the prompt's
 * version, then one judged word a line, sorted so a re-run diffs cleanly. A word judged to need
 * nothing has a line too, so a later run doesn't ask again. Senses are named by their first
 * gloss, not their position, so a judgment follows its sense when the dictionary reorders them.
 */

export const ARTIFACTS = {
  "ja-form": "data/labels/ja-form.jsonl",
  "pitfalls-ja": "data/pitfalls/ja.jsonl",
  "pitfalls-en": "data/pitfalls/en.jsonl",
  loans: "data/loans/verdicts.jsonl"
} as const

export type Pass = keyof typeof ARTIFACTS
export const PASSES = Object.keys(ARTIFACTS) as ReadonlyArray<Pass>

export const ArtifactHeader = Schema.Struct({
  pass: Schema.String,
  model: Schema.String,
  promptVersion: Schema.Int,
  /** The lines quote dictionary text (glosses), so they share its licence. */
  licence: Schema.String
})
export type ArtifactHeader = typeof ArtifactHeader.Type

export const LICENCE = "Quotes JMdict and Wiktionary glosses: CC BY-SA 4.0, see NOTICE.md in this directory"

/** A Japanese word's senses Jev judged formal, by first gloss, with its probability; empty for none. */
export const FormLine = Schema.Struct({
  entryId: Schema.Int,
  headword: Schema.String,
  form: Schema.Array(Schema.Struct({ gloss: Schema.String, p: Schema.Number }))
})
export type FormLine = typeof FormLine.Type

export const PitfallLine = Schema.Struct({
  entryId: Schema.Int,
  headword: Schema.String,
  pitfalls: Schema.Array(
    Schema.Struct({
      kind: PitfallKind,
      text: Schema.String,
      /** The first gloss of the sense it is about; null for the whole word. */
      sense: Schema.NullOr(Schema.String),
      /** The word it compares with, as written; linked where exactly one entry is written so. */
      about: Schema.NullOr(Schema.String)
    })
  )
})
export type PitfallLine = typeof PitfallLine.Type

/**
 * An English word's katakana loan as Jev judged it: the likeliest candidate and its meaning, or
 * nulls when no candidate was likely enough or the meaning unsure. Only a verdict is imported.
 */
export const LoanLine = Schema.Struct({
  english: Schema.String,
  englishId: Schema.Int,
  katakana: Schema.NullOr(Schema.String),
  katakanaId: Schema.NullOr(Schema.Int),
  meaning: Schema.NullOr(LoanLinkMeaning),
  /** The probability of the likeliest meaning, both option orders averaged. */
  p: Schema.NullOr(Schema.Number)
})
export type LoanLine = typeof LoanLine.Type

export interface Artifact<L> {
  readonly header: ArtifactHeader
  readonly lines: ReadonlyArray<L>
}

const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(ArtifactHeader))

/** The artifact's header and the lines that decode; null when the file is absent or has no header. */
export const parseArtifact = <A>(text: string, line: Schema.Codec<A, unknown>): Artifact<A> | null => {
  const [first, ...rest] = text.split("\n")
  const header = decodeHeader(first ?? "")
  if (Option.isNone(header)) return null
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(line))
  const lines = rest.flatMap((raw) => {
    if (raw.trim().length === 0) return []
    const decoded = decode(raw)
    return Option.isSome(decoded) ? [decoded.value] : []
  })
  return { header: header.value, lines }
}

/** The file's text: the header, then the lines sorted by `key`. */
export const serializeArtifact = <L>(
  header: ArtifactHeader,
  lines: Iterable<L>,
  key: (line: L) => string | number
): string => {
  const sorted = [...lines].sort((a, b) => {
    const [x, y] = [key(a), key(b)]
    return x < y ? -1 : x > y ? 1 : 0
  })
  return [header, ...sorted].map((line) => JSON.stringify(line)).join("\n") + "\n"
}

/** Reads an artifact from the repository, or null when it isn't there. */
export const readArtifact = Effect.fnUntraced(function* <A>(path: string, line: Schema.Codec<A, unknown>) {
  const fs = yield* FileSystem.FileSystem
  const file = resolveFromRoot(path)
  if (!(yield* fs.exists(file))) return null
  return parseArtifact(yield* fs.readFileString(file), line)
})
