import { CautionKind, LoanLinkMeaning } from "@kotori/db"
import { Effect, FileSystem, Option, Schema } from "effect"
import { resolveFromRoot } from "../../../runtime/Paths.ts"

export const ARTIFACTS = {
  "ja-form": "data/labels/ja-form.jsonl",
  "cautions-ja": "data/cautions/ja.jsonl",
  "cautions-en": "data/cautions/en.jsonl",
  loans: "data/loans/verdicts.jsonl"
} as const

export type Pass = keyof typeof ARTIFACTS
export const PASSES = Object.keys(ARTIFACTS) as ReadonlyArray<Pass>

export const ArtifactHeader = Schema.Struct({
  pass: Schema.String,
  model: Schema.String,
  promptVersion: Schema.Int,
  licence: Schema.String
})
export type ArtifactHeader = typeof ArtifactHeader.Type

export const LICENCE = "Quotes JMdict and Wiktionary glosses: CC BY-SA 4.0, see NOTICE.md in this directory"

// Senses in artifacts are keyed by first gloss rather than numeric index so judgments survive sense reordering on re-import.
export const FormalLabelLine = Schema.Struct({
  entryId: Schema.Int,
  headword: Schema.String,
  form: Schema.Array(Schema.Struct({ gloss: Schema.String, p: Schema.Number }))
})
export type FormalLabelLine = typeof FormalLabelLine.Type

export const CautionLine = Schema.Struct({
  entryId: Schema.Int,
  headword: Schema.String,
  cautions: Schema.Array(
    Schema.Struct({
      kind: CautionKind,
      text: Schema.String,
      sense: Schema.NullOr(Schema.String),
      about: Schema.NullOr(Schema.String)
    })
  )
})
export type CautionLine = typeof CautionLine.Type

export const LoanLine = Schema.Struct({
  english: Schema.String,
  englishId: Schema.Int,
  katakana: Schema.NullOr(Schema.String),
  katakanaId: Schema.NullOr(Schema.Int),
  meaning: Schema.NullOr(LoanLinkMeaning),
  p: Schema.NullOr(Schema.Number)
})
export type LoanLine = typeof LoanLine.Type

export interface Artifact<L> {
  readonly header: ArtifactHeader
  readonly lines: ReadonlyArray<L>
  readonly skipped: ReadonlyArray<number>
}

const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(ArtifactHeader))

export const parseArtifact = <A>(text: string, line: Schema.Codec<A, unknown>): Artifact<A> | null => {
  const [first, ...rest] = text.split("\n")
  const header = decodeHeader(first ?? "")
  if (Option.isNone(header)) return null
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(line))
  const lines: Array<A> = []
  const skipped: Array<number> = []
  rest.forEach((raw, index) => {
    if (raw.trim().length === 0) return
    const decoded = decode(raw)
    if (Option.isSome(decoded)) lines.push(decoded.value)
    else skipped.push(index + 2)
  })
  return { header: header.value, lines, skipped }
}

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

export const readArtifact = Effect.fnUntraced(function* <A>(path: string, line: Schema.Codec<A, unknown>, pass: Pass) {
  const fs = yield* FileSystem.FileSystem
  const file = resolveFromRoot(path)
  if (!(yield* fs.exists(file))) return null
  const artifact = parseArtifact(yield* fs.readFileString(file), line)
  // Fail rather than returning null on an unreadable file, since applyArtifacts treats null (missing file) as removing all pass data.
  if (artifact === null) return yield* Effect.fail(`${path} has no header naming its pass.`)
  if (artifact.header.pass !== pass) {
    return yield* Effect.fail(`${path} holds the ${artifact.header.pass} pass, not ${pass}.`)
  }
  if (artifact.skipped.length > 0) {
    const count = artifact.skipped.length
    yield* Effect.logWarning(
      `${path}: skipped ${count} ${count === 1 ? "line" : "lines"} that don't decode ` +
        `(${count === 1 ? "line" : "lines"} ${artifact.skipped.join(", ")})`
    )
  }
  return artifact
})
