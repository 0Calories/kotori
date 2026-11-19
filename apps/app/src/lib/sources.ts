import type { Language, Source } from "@kotori/contracts"
import type { Strings } from "../i18n/strings.ts"

export const entrySourcesHref = (id: number) => ({ pathname: "/sources/[id]", params: { id: String(id) } }) as const

export const entryIdFromParam = (id: string | readonly string[] | undefined): number | null => {
  const raw = Array.isArray(id) ? id[0] : id
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export interface SourcedEntry {
  readonly language: Language
  readonly source: Source
  readonly audioUrl: string | null
  readonly audio: ReadonlyArray<unknown>
  readonly labels: ReadonlyArray<{ readonly source: Source }>
  readonly cautions: ReadonlyArray<{ readonly source: Source }>
  readonly loanLink: { readonly source: Source; readonly meaningSource: Source | null } | null
  readonly senses: ReadonlyArray<{
    readonly labels: ReadonlyArray<{ readonly source: Source }>
    readonly usagePatterns: ReadonlyArray<{ readonly source: Source }>
    readonly examples: ReadonlyArray<{
      readonly source: Source
      readonly audioUrl: string | null
      readonly translationAudioUrl: string | null
    }>
    readonly similarWords: ReadonlyArray<unknown>
  }>
}

export type AttributionId =
  | "dictionary"
  | "kotori"
  | "examples"
  | "tatoeba"
  | "wiktionary"
  | "similar"
  | "audio"
  | "loan"

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

export const entryAttributions = (t: Strings, entry: SourcedEntry): ReadonlyArray<Attribution> => {
  const senses = entry.senses
  const examples = senses.flatMap((sense) => sense.examples)
  const exampleFrom = (...sources: ReadonlyArray<Source>) =>
    examples.some((example) => sources.includes(example.source))
  const kotoriNotes = [
    ...entry.labels,
    ...entry.cautions,
    ...senses.flatMap((sense) => [...sense.labels, ...sense.usagePatterns])
  ].some((fact) => fact.source === "kotori")
  const rows: Array<Attribution> = [
    {
      id: "dictionary",
      title: t.entry.sourceDictionary,
      body:
        entry.source === "kotori"
          ? t.entry.sourceDictionaryKotori
          : entry.language === "ja"
            ? t.entry.sourceDictionaryJa
            : t.entry.sourceDictionaryEn
    }
  ]
  if (kotoriNotes && entry.source !== "kotori") {
    rows.push({ id: "kotori", title: t.entry.sourceKotori, body: t.entry.sourceKotoriBody })
  }
  if (exampleFrom("kotori")) {
    rows.push({ id: "examples", title: t.entry.sourceExamples, body: t.entry.sourceExamplesBody })
  }
  if (exampleFrom("tatoeba")) {
    rows.push({ id: "tatoeba", title: t.entry.sourceTatoeba, body: t.entry.sourceTatoebaBody })
  }
  if (exampleFrom("jawiktionary", "enwiktionary")) {
    rows.push({ id: "wiktionary", title: t.entry.sourceWiktionary, body: t.entry.sourceWiktionaryBody })
  }
  if (senses.some((sense) => sense.similarWords.length > 0)) {
    rows.push({ id: "similar", title: t.entry.sourceSimilar, body: t.entry.sourceSimilarBody })
  }
  if (hasAudio(entry)) {
    rows.push({ id: "audio", title: t.entry.sourceAudio, body: t.entry.sourceAudioBody })
  }
  // Skip crediting the loan pair separately when it came from the entry's primary dictionary source.
  const link = entry.loanLink
  if (link !== null) {
    const named = link.source !== entry.source && link.source !== "kotori"
    const judged = link.meaningSource === "kotori"
    if (named || judged) {
      rows.push({
        id: "loan",
        title: t.entry.sourceLoan,
        body: named && judged ? t.entry.sourceLoanBoth : named ? t.entry.sourceLoanDictionary : t.entry.sourceLoanKotori
      })
    }
  }
  return rows
}
