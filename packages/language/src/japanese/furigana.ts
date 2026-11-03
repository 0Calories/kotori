/**
 * Furigana is written inline as `{base|reading}`, e.g. `{食|た}べる`.
 * The notation is unambiguous, survives JSON, and is easy for models to produce.
 */
export interface RubySegment {
  readonly text: string
  readonly reading: string | null
}

const RUBY = /\{([^|{}]+)\|([^{}]+)\}/g

export const parseFurigana = (input: string): Array<RubySegment> => {
  const segments: Array<RubySegment> = []
  let last = 0
  for (const match of input.matchAll(RUBY)) {
    if (match.index > last) segments.push({ text: input.slice(last, match.index), reading: null })
    segments.push({ text: match[1]!, reading: match[2]! })
    last = match.index + match[0].length
  }
  if (last < input.length) segments.push({ text: input.slice(last), reading: null })
  return segments
}

/** The sentence as normally written. */
export const furiganaToText = (input: string) =>
  parseFurigana(input)
    .map((s) => s.text)
    .join("")

/** The sentence with every annotated base replaced by its reading. */
export const furiganaToKana = (input: string) =>
  parseFurigana(input)
    .map((s) => s.reading ?? s.text)
    .join("")
