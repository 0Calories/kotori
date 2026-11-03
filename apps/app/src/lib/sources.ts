import type { Language } from "@kotori/contracts"
import type { Strings } from "../i18n/strings.ts"

/**
 * Where an entry's Sources control goes. One target on web and native:
 * `/sources/123` is the URL and the stack screen, and `id` is the entry, so
 * the screen can name that word's dictionary and whatever was added to it.
 */
export const entrySourcesHref = (id: number) => ({ pathname: "/sources/[id]", params: { id: String(id) } }) as const

/** `useLocalSearchParams` may hand back a string or a one-element list. */
export const entryIdFromParam = (id: string | readonly string[] | undefined): number | null => {
  const raw = Array.isArray(id) ? id[0] : id
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** The parts of an entry the sources screen can credit. Narrower than `Entry`, which satisfies it. */
export interface SourcedEntry {
  readonly language: Language
  readonly audioUrl: string | null
  readonly audio: ReadonlyArray<unknown>
  readonly loan: object | null
  readonly senses: ReadonlyArray<{
    readonly nuance: object | null
    readonly examples: ReadonlyArray<{
      readonly audioUrl: string | null
      readonly translationAudioUrl: string | null
    }>
    readonly similar: ReadonlyArray<unknown>
  }>
}

export type AttributionId = "dictionary" | "nuance" | "examples" | "similar" | "audio" | "loan"

export interface Attribution {
  readonly id: AttributionId
  readonly title: string
  readonly body: string
}

const hasAudio = (entry: SourcedEntry) =>
  entry.audioUrl !== null ||
  entry.audio.length > 0 ||
  entry.senses.some((sense) =>
    sense.examples.some((example) => example.audioUrl !== null || example.translationAudioUrl !== null)
  )

/**
 * Credits for this entry only: the dictionary it was taken from, then each
 * added part that is actually on the page. A dictionary-only word lists the
 * dictionary and nothing else.
 */
export const entryAttributions = (t: Strings, entry: SourcedEntry): ReadonlyArray<Attribution> => {
  const senses = entry.senses
  const rows: Array<Attribution> = [
    {
      id: "dictionary",
      title: t.entry.sourceDictionary,
      body: entry.language === "ja" ? t.entry.sourceDictionaryJa : t.entry.sourceDictionaryEn
    }
  ]
  if (senses.some((sense) => sense.nuance !== null)) {
    rows.push({ id: "nuance", title: t.entry.sourceNuance, body: t.entry.sourceNuanceBody })
  }
  if (senses.some((sense) => sense.examples.length > 0)) {
    rows.push({ id: "examples", title: t.entry.sourceExamples, body: t.entry.sourceExamplesBody })
  }
  if (senses.some((sense) => sense.similar.length > 0)) {
    rows.push({ id: "similar", title: t.entry.sourceSimilar, body: t.entry.sourceSimilarBody })
  }
  if (hasAudio(entry)) {
    rows.push({ id: "audio", title: t.entry.sourceAudio, body: t.entry.sourceAudioBody })
  }
  if (entry.loan !== null) {
    rows.push({ id: "loan", title: t.entry.sourceLoan, body: t.entry.sourceLoanBody })
  }
  return rows
}
