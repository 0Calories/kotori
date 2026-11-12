import type { Source } from "@kotori/db"

/**
 * Which example sentences get audio. Kotori's sentences, written for learners, are always voiced.
 * A sentence seeded from Tatoeba or Wiktionary is voiced only on a sense Kotori wrote none for,
 * where it is the example the learner hears; beside Kotori's it is shown but not read aloud, so its
 * voice isn't paid for. While Kotori's sentences may still come (`examplesToCome`), its seeded
 * ones wait: the new sentences may cover their senses, and would hide their clips.
 */
export const sentencesToVoice = <E extends { readonly sense: number; readonly source: Source }>(
  examples: ReadonlyArray<E>,
  options: { readonly writing: boolean }
): Array<E> => {
  const written = new Set(examples.flatMap((example) => (example.source === "kotori" ? [example.sense] : [])))
  return examples.filter((example) => example.source === "kotori" || (!options.writing && !written.has(example.sense)))
}

/**
 * The sentences whose clips are served: Kotori's, and a seeded one only on a sense with none of
 * Kotori's. A seeded sentence voiced while it was its sense's only example keeps its clip in
 * storage, but once Kotori's sentences are beside it, it is shown without one.
 */
export const sentencesHeard = <E extends { readonly sense: number; readonly source: Source }>(
  examples: ReadonlyArray<E>
): Array<E> => sentencesToVoice(examples, { writing: false })

/**
 * Whether Kotori's sentences for an entry may still come: its examples job is still to run, or
 * has never been asked for and the entry has none of Kotori's (Claude was down when the word was
 * first looked at). A job that settled has tried, whatever it wrote.
 */
export const examplesToCome = (status: string | undefined, examples: ReadonlyArray<{ readonly source: Source }>) =>
  status === "queued" ||
  status === "running" ||
  (status === undefined && !examples.some((example) => example.source === "kotori"))
