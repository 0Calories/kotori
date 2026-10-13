import { Claude } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, type GlossMatch, JobsRepo, normalizeGloss } from "@kotori/db"
import {
  type Enrichment,
  type EnrichmentStatus,
  type Entry,
  EntryId,
  type EntrySummary,
  type Formality,
  type SearchResult,
  type Sense,
  type SimilarWord,
  type Tag
} from "@kotori/domain"
import { deinflect, hasJapanese, katakanaToHiragana, matchesPartOfSpeech, romajiToKana, romanize } from "@kotori/japanese"
import { Jev } from "@kotori/nuance"
import { Pronouncer } from "@kotori/tts"
import { Clock, Context, Effect, Layer, Option } from "effect"

export const audioUrl = (key: string) => `/audio/${key}.mp3`

/** Priority for work requested by someone looking at an entry, above any batch backfill. */
const ON_DEMAND = 1_000

interface Hit {
  readonly entryId: number
  readonly score: number
  readonly inflection: ReadonlyArray<string>
}

const keepBest = (hits: Iterable<Hit>) => {
  const best = new Map<number, Hit>()
  for (const hit of hits) {
    const current = best.get(hit.entryId)
    if (current === undefined || hit.score > current.score) best.set(hit.entryId, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

const unique = <A>(items: Iterable<A>) => [...new Set(items)]

const SENSE_BONUS = [40, 25, 15, 10, 5]

/** Usage tags that make a word a less likely answer to a plain English query. */
const TAG_PENALTY: Record<string, number> = {
  arch: 30,
  obs: 30,
  obsc: 30,
  rare: 25,
  hist: 10,
  vulg: 15,
  X: 15,
  derog: 15,
  sl: 8,
  "net-sl": 8,
  "m-sl": 8,
  male: 6,
  fem: 6,
  col: 4,
  hon: 6,
  hum: 6,
  form: 6,
  poet: 10
}

const tagPenalty = (misc: ReadonlyArray<string>) => misc.reduce((sum, tag) => sum + (TAG_PENALTY[tag] ?? 0), 0)

/** An FTS5 expression requiring every word of the query, each quoted so user input can't be parsed as syntax. */
const ftsExpression = (query: string) => {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length === 0 ? null : words.map((word) => `"${word}"`).join(" ")
}

const firstGlosses = (entry: EntryRecord, count: number) => {
  const meanings = entry.senses[0]?.glosses.slice(0, count).map((gloss) => gloss.text) ?? []
  const second = entry.senses[1]?.glosses[0]?.text
  return meanings.length < count && second !== undefined ? [...meanings, second] : meanings
}

export class Dictionary extends Context.Service<Dictionary, {
  search(query: string, limit: number): Effect.Effect<SearchResult>
  entry(id: EntryId): Effect.Effect<Option.Option<Entry>>
  /** Queues whatever enrichment an entry is missing, returning its status. */
  requestEnrichment(id: EntryId): Effect.Effect<Option.Option<Enrichment>>
  /** Entry ids for words, for linking coach vocabulary to the dictionary. */
  lookupWords(words: ReadonlyArray<{ readonly word: string; readonly reading: string }>): Effect.Effect<ReadonlyArray<EntryId | null>>
}>()("@kotori/api/Dictionary") {
  static readonly layer = Layer.effect(
    Dictionary,
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const jev = yield* Jev
      const claude = yield* Claude
      const pronouncer = yield* Pronouncer

      // ---------------------------------------------------------------------
      // Search
      // ---------------------------------------------------------------------

      const japaneseHits = Effect.fnUntraced(function*(query: string) {
        const variants = unique([query, katakanaToHiragana(query)])
        const candidates = variants.flatMap(deinflect)
        const matches = yield* repo.findForms(unique(candidates.map((candidate) => candidate.term)))
        const entries = new Map((yield* repo.getEntries(unique(matches.map((m) => m.entryId)))).map((e) => [e.id, e]))

        const exact = matches.flatMap((match): Array<Hit> => {
          const entry = entries.get(match.entryId)
          if (entry === undefined) return []
          const pos = entry.senses.flatMap((sense) => sense.pos)
          return candidates
            .filter((candidate) => candidate.term === match.text && matchesPartOfSpeech(candidate.type, pos))
            .map((candidate) => ({
              entryId: entry.id,
              score: (candidate.reasons.length === 0 ? 1000 : 800 - 10 * candidate.reasons.length) +
                (match.text === entry.headword ? 20 : 0) + (entry.common ? 50 : 0) + entry.priority / 10,
              inflection: candidate.reasons
            }))
        })

        const prefixIds = yield* repo.findFormPrefix(query, 40)
        const ranks = yield* repo.ranks(prefixIds)
        const prefix = prefixIds.map((entryId, index): Hit => ({
          entryId,
          score: 400 - index + (ranks.get(entryId)?.common ? 50 : 0),
          inflection: []
        }))
        return keepBest([...exact, ...prefix])
      })

      const englishHits = Effect.fnUntraced(function*(query: string) {
        const expression = ftsExpression(query)
        const exact = yield* repo.findGlossesExact(query, 300)
        const fuzzy = expression === null ? [] : yield* repo.searchGlosses(expression, 600)
        const norm = normalizeGloss(query)
        const ranks = yield* repo.ranks(unique([...exact, ...fuzzy].map((match) => match.entryId)))

        const score = (match: GlossMatch, isExact: boolean): Hit => {
          const rank = ranks.get(match.entryId)
          const glossNorm = normalizeGloss(match.text)
          return {
            entryId: match.entryId,
            score: (isExact ? 100 : 30) +
              (!isExact && glossNorm.startsWith(norm) ? 15 : 0) +
              (SENSE_BONUS[match.sense] ?? 0) -
              3 * match.position -
              4 * Math.min(match.glossCount - 1, 5) -
              tagPenalty(match.misc) +
              Math.min(10, -match.rank) +
              (rank?.common ? 30 : 0) +
              (rank?.priority ?? 0) / 5,
            inflection: []
          }
        }
        return keepBest([...exact.map((m) => score(m, true)), ...fuzzy.map((m) => score(m, false))])
      })

      const summaries = Effect.fnUntraced(function*(hits: ReadonlyArray<Hit>) {
        const ids = hits.map((hit) => hit.entryId)
        const entries = new Map((yield* repo.getEntries(ids)).map((entry) => [entry.id, entry]))
        const nuance = yield* enrichment.nuanceFor(ids)
        const formality = new Map(
          nuance.filter((row) => row.sense === 0).map((row) => [row.entryId, row.nuance.formality.value] as const)
        )
        return hits.flatMap((hit): Array<EntrySummary> => {
          const entry = entries.get(hit.entryId)
          if (entry === undefined) return []
          return [{
            id: EntryId.make(entry.id),
            headword: entry.headword,
            reading: entry.reading,
            romaji: romanize(entry.reading),
            common: entry.common,
            meanings: firstGlosses(entry, 3),
            partOfSpeech: entry.senses[0]?.pos[0] ?? null,
            formality: formality.get(entry.id) ?? null,
            inflection: hit.inflection
          }]
        })
      })

      const search = Effect.fn("Dictionary.search")(function*(raw: string, limit: number) {
        const query = raw.normalize("NFKC").trim()
        if (query.length === 0) return { query, mode: "english" as const, reading: null, entries: [] }

        if (hasJapanese(query)) {
          const hits = yield* japaneseHits(query)
          return { query, mode: "japanese" as const, reading: null, entries: yield* summaries(hits.slice(0, limit)) }
        }

        const english = yield* englishHits(query)
        const kana = romajiToKana(query)
        const romaji = kana === null ? [] : (yield* japaneseHits(kana)).filter((hit) => hit.score >= 700)
        const englishIsStrong = (english[0]?.score ?? 0) >= 150
        const preferRomaji = romaji.length > 0 && !englishIsStrong
        const ordered = preferRomaji ? keepBest([...romaji, ...english.map((h) => ({ ...h, score: h.score - 1000 }))]) : [
          ...english,
          ...romaji.filter((hit) => !english.some((e) => e.entryId === hit.entryId))
        ]
        return {
          query,
          mode: preferRomaji ? "romaji" as const : "english" as const,
          reading: preferRomaji ? kana : null,
          entries: yield* summaries(ordered.slice(0, limit))
        }
      })

      // ---------------------------------------------------------------------
      // Entries
      // ---------------------------------------------------------------------

      const status = (ready: boolean, available: boolean, job: string | undefined): EnrichmentStatus =>
        ready ? "ready" : !available || job === "failed" ? "unavailable" : "queued"

      const enrichmentFor = Effect.fnUntraced(function*(entry: EntryRecord, enqueue: boolean) {
        const hasNuance = (yield* enrichment.nuanceFor([entry.id])).length > 0
        const hasExamples = (yield* enrichment.examplesFor([entry.id])).length > 0
        const hasAudio = (yield* enrichment.entryAudio([entry.id])).size > 0
        const coachAvailable = yield* claude.available
        const now = yield* Clock.currentTimeMillis

        if (enqueue) {
          if (!hasNuance && jev.configured) yield* jobs.enqueue("nuance", entry.id, ON_DEMAND, now)
          if (!hasExamples && coachAvailable) yield* jobs.enqueue("examples", entry.id, ON_DEMAND, now)
          // The worker re-runs audio once example sentences exist, so they get voiced too.
          if (!hasAudio && pronouncer.configured) yield* jobs.enqueue("audio", entry.id, ON_DEMAND, now)
        }

        const job = yield* jobs.statusFor(entry.id)
        return {
          nuance: status(hasNuance, jev.configured, job.get("nuance")),
          examples: status(hasExamples, coachAvailable, job.get("examples")),
          audio: status(hasAudio, pronouncer.configured, job.get("audio"))
        }
      })

      const assemble = Effect.fnUntraced(function*(entry: EntryRecord) {
        const tags = yield* repo.tags
        const tag = (code: string): Tag => ({ code, label: tags.get(code) ?? code })

        const nuance = new Map((yield* enrichment.nuanceFor([entry.id])).map((row) => [row.sense, row.nuance]))
        const examples = yield* enrichment.examplesFor([entry.id])
        const exampleAudio = yield* enrichment.exampleAudio(examples.map((example) => example.id))
        const entryAudio = (yield* enrichment.entryAudio([entry.id])).get(entry.id)

        const similarRows = yield* enrichment.similarFor(entry.id)
        const similarIds = unique(similarRows.map((row) => row.similarId))
        const similarEntries = new Map((yield* repo.getEntries(similarIds)).map((e) => [e.id, e]))
        const similarFormality = new Map(
          (yield* enrichment.nuanceFor(similarIds))
            .filter((row) => row.sense === 0)
            .map((row) => [row.entryId, row.nuance.formality.value] as const)
        )

        const xrefTexts = unique(entry.senses.flatMap((s) => [...s.xrefs, ...s.antonyms]).map((x) => x.split("・")[0]!))
        const xrefMatches = yield* repo.findForms(xrefTexts)
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
              return [{
                entryId: EntryId.make(similar.id),
                headword: similar.headword,
                reading: similar.reading,
                meaning: firstGlosses(similar, 2).join("; "),
                difference: row.difference,
                confidence: row.confidence,
                formality: (similarFormality.get(similar.id) ?? null) as Formality | null
              }]
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
          enrichment: yield* enrichmentFor(entry, true)
        } satisfies Entry
      })

      const entry = Effect.fn("Dictionary.entry")(function*(id: EntryId) {
        const [record] = yield* repo.getEntries([id])
        return record === undefined ? Option.none() : Option.some(yield* assemble(record))
      })

      const requestEnrichment = Effect.fn("Dictionary.requestEnrichment")(function*(id: EntryId) {
        const [record] = yield* repo.getEntries([id])
        return record === undefined ? Option.none() : Option.some(yield* enrichmentFor(record, true))
      })

      const lookupWords = Effect.fn("Dictionary.lookupWords")(
        function*(words: ReadonlyArray<{ readonly word: string; readonly reading: string }>) {
          const matches = yield* repo.findForms(unique(words.flatMap((w) => [w.word, w.reading])))
          const ranks = yield* repo.ranks(unique(matches.map((m) => m.entryId)))
          return words.map(({ word, reading }) => {
            const candidates = matches.filter((m) => m.text === word || m.text === reading)
            // Prefer an entry matching both spelling and reading, then the most frequent.
            const best = candidates
              .map((m) => ({
                id: m.entryId,
                score: (candidates.filter((c) => c.entryId === m.entryId).length > 1 ? 1000 : 0) +
                  (m.text === word ? 100 : 0) + (ranks.get(m.entryId)?.priority ?? 0)
              }))
              .sort((a, b) => b.score - a.score)[0]
            return best === undefined ? null : EntryId.make(best.id)
          })
        }
      )

      return Dictionary.of({ search, entry, requestEnrichment, lookupWords })
    })
  )
}
