import type { Source } from "@kotori/db"
import type { JobStatus } from "./jobs.ts"

// Hold off voicing seeded examples while Kotori's examples are still pending, since new Kotori examples on a sense supersede seeded audio.
export const sentencesToVoice = <E extends { readonly sense: number; readonly source: Source }>(
  examples: ReadonlyArray<E>,
  options: { readonly writing: boolean }
): Array<E> => {
  const written = new Set(examples.flatMap((example) => (example.source === "kotori" ? [example.sense] : [])))
  return examples.filter((example) => example.source === "kotori" || (!options.writing && !written.has(example.sense)))
}

export const sentencesHeard = <E extends { readonly sense: number; readonly source: Source }>(
  examples: ReadonlyArray<E>
): Array<E> => sentencesToVoice(examples, { writing: false })

export const examplesToCome = (status: JobStatus | undefined, examples: ReadonlyArray<{ readonly source: Source }>) =>
  status === "queued" ||
  status === "running" ||
  (status === undefined && !examples.some((example) => example.source === "kotori"))
