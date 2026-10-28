import { Database } from "@kotori/db"
import { similarWords } from "@kotori/db/schema"
import {
  type Enrichment,
  type EnrichmentStatus,
  type Entry,
  EntryId,
  type Sense,
  type SimilarWord,
  type Tag
} from "@kotori/domain"
import { romanize } from "@kotori/japanese"
import type { EntryRecord } from "@kotori/jmdict"
import { asc, desc, eq } from "drizzle-orm"
import { Effect, Option } from "effect"
import { audioUrl, entryClips, exampleClips } from "../enrichment/audio.ts"
import { examplesFor } from "../enrichment/examples.ts"
import { enqueue, statusFor } from "../enrichment/jobs.ts"
import { nuanceFor } from "../enrichment/nuance.ts"
import { available } from "../enrichment/run.ts"
import { findForms, firstGlosses, getEntries, tagLabels } from "./entries.ts"

/** Priority for work requested by someone looking at an entry, above any batch backfill. */
const ON_DEMAND = 1_000

const unique = <A>(items: Iterable<A>) => [...new Set(items)]

const similarFor = Effect.fn("dictionary.similarFor")(function* (entryId: number) {
  const db = yield* Database
  return yield* db
    .select({
      sense: similarWords.sense,
      similarId: similarWords.similarId,
      difference: similarWords.difference,
      confidence: similarWords.confidence
    })
    .from(similarWords)
    .where(eq(similarWords.entryId, entryId))
    .orderBy(asc(similarWords.sense), desc(similarWords.similarity))
}, Effect.orDie)

const status = (ready: boolean, available: boolean, job: string | undefined): EnrichmentStatus =>
  ready ? "ready" : !available || job === "failed" ? "unavailable" : "queued"

/** Queues whatever enrichment an entry is missing and has a provider for, returning where each kind stands. */
const enrich = Effect.fnUntraced(function* (entry: EntryRecord) {
  const hasNuance = (yield* nuanceFor([entry.id])).length > 0
  const hasExamples = (yield* examplesFor([entry.id])).length > 0
  const hasAudio = (yield* entryClips([entry.id])).size > 0
  const kinds = yield* available

  if (!hasNuance && kinds.includes("nuance")) yield* enqueue("nuance", entry.id, ON_DEMAND)
  if (!hasExamples && kinds.includes("examples")) yield* enqueue("examples", entry.id, ON_DEMAND)
  // The worker re-runs audio once example sentences exist, so they get voiced too.
  if (!hasAudio && kinds.includes("audio")) yield* enqueue("audio", entry.id, ON_DEMAND)

  const job = yield* statusFor(entry.id)
  return {
    nuance: status(hasNuance, kinds.includes("nuance"), job.get("nuance")),
    examples: status(hasExamples, kinds.includes("examples"), job.get("examples")),
    audio: status(hasAudio, kinds.includes("audio"), job.get("audio"))
  } satisfies Enrichment
})

const assemble = Effect.fnUntraced(function* (entry: EntryRecord) {
  const tags = yield* tagLabels
  const tag = (code: string): Tag => ({ code, label: tags.get(code) ?? code })

  const nuance = new Map((yield* nuanceFor([entry.id])).map((row) => [row.sense, row.nuance]))
  const examples = yield* examplesFor([entry.id])
  const exampleAudio = yield* exampleClips(examples.map((example) => example.id))
  const entryAudio = (yield* entryClips([entry.id])).get(entry.id)

  const similarRows = yield* similarFor(entry.id)
  const similarIds = unique(similarRows.map((row) => row.similarId))
  const similarEntries = new Map((yield* getEntries(similarIds)).map((e) => [e.id, e]))
  const similarFormality = new Map(
    (yield* nuanceFor(similarIds))
      .filter((row) => row.sense === 0)
      .map((row) => [row.entryId, row.nuance.formality.value])
  )

  const xrefTexts = unique(entry.senses.flatMap((s) => [...s.xrefs, ...s.antonyms]).map((x) => x.split("・")[0]!))
  const xrefMatches = yield* findForms(xrefTexts)
  const resolve = (xref: string) => {
    const [text = xref, reading] = xref.split("・")
    const match = xrefMatches.find((m) => m.text === text)
    return {
      text: reading !== undefined && !/^\d+$/.test(reading) ? `${text}（${reading}）` : text,
      entryId: match ? EntryId.make(match.entryId) : null
    }
  }

  const senses = entry.senses.map((sense, index): Sense => ({
    index,
    glosses: sense.glosses.map((gloss) => gloss.text),
    partsOfSpeech: sense.pos.map(tag),
    misc: sense.misc.map(tag),
    fields: sense.fields.map(tag),
    dialects: sense.dialects.map(tag),
    info: sense.info,
    appliesTo: [...sense.stagk, ...sense.stagr],
    related: sense.xrefs.map(resolve),
    antonyms: sense.antonyms.map(resolve),
    nuance: nuance.get(index) ?? null,
    similar: similarRows
      .filter((row) => row.sense === index)
      .flatMap((row): Array<SimilarWord> => {
        const similar = similarEntries.get(row.similarId)
        if (similar === undefined) return []
        return [
          {
            entryId: EntryId.make(similar.id),
            headword: similar.headword,
            reading: similar.reading,
            meaning: firstGlosses(similar, 2).join("; "),
            difference: row.difference,
            confidence: row.confidence,
            formality: similarFormality.get(similar.id) ?? null
          }
        ]
      }),
    examples: examples
      .filter((example) => example.sense === index)
      .map((example) => {
        const ja = exampleAudio.get(`${example.id}:ja`)
        const en = exampleAudio.get(`${example.id}:en`)
        return {
          id: example.id,
          ja: example.ja,
          furigana: example.furigana,
          en: example.en,
          formality: example.formality,
          note: example.note,
          audioUrl: ja === undefined ? null : audioUrl(ja),
          translationAudioUrl: en === undefined ? null : audioUrl(en)
        }
      })
  }))

  return {
    id: EntryId.make(entry.id),
    headword: entry.headword,
    reading: entry.reading,
    romaji: romanize(entry.reading),
    common: entry.common,
    forms: entry.forms
      .filter((form) => !form.tags.includes("sK") && !form.tags.includes("sk"))
      .map((form) => ({ text: form.text, kind: form.kind, common: form.common, tags: form.tags.map(tag) })),
    senses,
    audioUrl: entryAudio === undefined ? null : audioUrl(entryAudio),
    enrichment: yield* enrich(entry)
  } satisfies Entry
})

/** An entry page: meanings, nuance, similar words, examples and audio. Looking queues what's missing. */
export const entry = Effect.fn("dictionary.entry")(function* (id: EntryId) {
  const [record] = yield* getEntries([id])
  return record === undefined ? Option.none<Entry>() : Option.some(yield* assemble(record))
})

/** Queues whatever enrichment an entry is missing, returning where each kind stands. */
export const requestEnrichment = Effect.fn("dictionary.requestEnrichment")(function* (id: EntryId) {
  const [record] = yield* getEntries([id])
  return record === undefined ? Option.none<Enrichment>() : Option.some(yield* enrich(record))
})
