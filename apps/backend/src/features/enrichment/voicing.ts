import type { Source } from "@kotori/db"

/**
 * Which example sentences get audio. Kotori's sentences, written for learners, are always voiced.
 * A sentence seeded from Tatoeba or Wiktionary is voiced only on a sense Kotori wrote none for,
 * where it is the example the learner hears; beside Kotori's it is shown but not read aloud, so its
 * voice isn't paid for. While Kotori is still writing an entry's sentences, its seeded ones wait:
 * the new sentences may cover their senses.
 */
export const sentencesToVoice = <E extends { readonly sense: number; readonly source: Source }>(
  examples: ReadonlyArray<E>,
  options: { readonly writing: boolean }
): Array<E> => {
  const written = new Set(examples.flatMap((example) => (example.source === "kotori" ? [example.sense] : [])))
  return examples.filter((example) => example.source === "kotori" || (!options.writing && !written.has(example.sense)))
}

/** Whether the entry's examples job is still to run, so Kotori's sentences are on their way. */
export const writingExamples = (status: string | undefined) => status === "queued" || status === "running"
