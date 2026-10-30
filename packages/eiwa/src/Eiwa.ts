import { DictionaryRepo, type EntryRecord, resolveFromRoot } from "@kotori/db"
import { entrySplitter } from "@kotori/jmdict"
import { Effect, FileSystem, Path, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { createGunzip } from "node:zlib"
import { mergeSources, type Source, toEntries } from "./build.ts"
import { EJDICT_FILES, parseEjdict } from "./ejdict.ts"
import { FREQUENCY_URL, parseFrequency } from "./frequency.ts"
import { jmdictReader, type KnownEnglish } from "./jmdict.ts"
import { ENGLISH_TAGS } from "./tags.ts"
import { WIKTIONARY_URL, wiktionaryParser } from "./wiktionary.ts"
import type { FormOf, Word } from "./words.ts"

export class EiwaError extends Schema.TaggedError<EiwaError>()("EiwaError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/** The downloaded sources, as paths relative to the repo root or absolute. */
export interface Files {
  /** Wiktextract's extraction of Japanese Wiktionary, gzipped JSON lines (or plain). */
  readonly wiktionary: string
  /** EJDict, its letters joined into one file. */
  readonly ejdict: string
  /** FrequencyWords' English list. */
  readonly frequency: string
}

/** Downloads the English dictionary's sources into `directory` (~65 MB, mostly Wiktionary). */
export const download = Effect.fn("Eiwa.download")(
  function* (directory: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const root = resolveFromRoot(directory)
    yield* fs.makeDirectory(root, { recursive: true })

    const files: Files = {
      wiktionary: path.join(root, "ja-wiktionary.jsonl.gz"),
      ejdict: path.join(root, "ejdict.txt"),
      frequency: path.join(root, "en_50k.txt")
    }
    yield* Effect.logInfo(`Downloading ${WIKTIONARY_URL}`)
    yield* (yield* client.get(WIKTIONARY_URL)).stream.pipe(Stream.run(fs.sink(files.wiktionary)))
    yield* Effect.logInfo("Downloading EJDict")
    const letters = yield* Effect.forEach(EJDICT_FILES, (url) => Effect.flatMap(client.get(url), (r) => r.text), {
      concurrency: 4
    })
    yield* fs.writeFileString(files.ejdict, letters.join("\n"))
    yield* Effect.logInfo(`Downloading ${FREQUENCY_URL}`)
    yield* fs.writeFileString(files.frequency, yield* Effect.flatMap(client.get(FREQUENCY_URL), (r) => r.text))
    return files
  },
  Effect.mapError((cause) => new EiwaError({ message: "Could not download the English dictionary", cause }))
)

/** Feeds each line of a text file, gzipped or not, to `read`, streaming it rather than loading it whole. */
const eachLine = (file: string, read: (line: string) => void) =>
  Effect.tryPromise({
    try: async () => {
      const input = createReadStream(resolveFromRoot(file))
      const lines = createInterface({
        input: file.endsWith(".gz") ? input.pipe(createGunzip()) : input,
        crlfDelay: Infinity
      })
      for await (const line of lines) read(line)
    },
    catch: (cause) => new EiwaError({ message: `Could not read ${file}`, cause })
  })

const readLines = (file: string) =>
  Effect.suspend(() => {
    const lines: Array<string> = []
    return Effect.as(
      eachLine(file, (line) => lines.push(line)),
      lines
    )
  })

/**
 * Each entry of a JMdict file, gzipped or not, as the text streams in: the whole document
 * would be ~120 MB in memory, more than the worker's machine spares for a seed.
 */
const eachJmdictEntry = (file: string, read: (entry: EntryRecord) => void) =>
  Effect.tryPromise({
    try: async () => {
      const input = createReadStream(resolveFromRoot(file))
      const split = entrySplitter()
      for await (const chunk of (file.endsWith(".gz") ? input.pipe(createGunzip()) : input).setEncoding("utf8")) {
        for (const entry of split(chunk as string)) read(entry)
      }
    },
    catch: (cause) => new EiwaError({ message: `Could not read ${file}`, cause })
  })

/** What the dictionary already knows before JMDict is read backwards for what is missing. */
const knownEnglish = (
  sources: ReadonlyArray<{ readonly words: ReadonlyArray<Word>; readonly formsOf: ReadonlyArray<FormOf> }>,
  phrases: ReadonlySet<string>,
  frequency: ReadonlyMap<string, number>
): KnownEnglish => {
  const words = new Set<string>()
  const verbs = new Set<string>()
  for (const source of sources) {
    for (const word of source.words) {
      for (const text of [word.headword, ...word.spellings, ...word.inflections.map((form) => form.text)]) {
        words.add(text.toLowerCase())
      }
      if (word.senses.some((sense) => sense.pos.includes("v"))) verbs.add(word.headword.toLowerCase())
    }
    for (const form of source.formsOf) words.add(form.text.toLowerCase())
  }
  return { words, verbs, phrases, frequency }
}

export interface ImportOptions {
  readonly files: Files
  /** JMdict_e.gz (or uncompressed XML), read backwards for words the other sources lack. */
  readonly jmdict: string
  /** Keep only this many words, the most used first, for quick local setups. */
  readonly limit?: number | undefined
  /** Only words common enough to be marked common (~10k). */
  readonly commonOnly?: boolean | undefined
  readonly batchSize?: number | undefined
}

/**
 * The English dictionary's entries, built from its sources. Its own scope, so everything
 * parsed along the way can be let go before the entries are written.
 */
const build = Effect.fnUntraced(function* (options: ImportOptions, existing: ReadonlyMap<string, number>) {
  const parser = wiktionaryParser()
  yield* eachLine(options.files.wiktionary, parser.add)
  const wiktionary = parser.finish()
  const ejdict = parseEjdict(yield* readLines(options.files.ejdict))
  const frequency = parseFrequency(yield* readLines(options.files.frequency))
  yield* Effect.logInfo(`Read ${wiktionary.words.length} words from Wiktionary and ${ejdict.words.length} from EJDict`)

  const reader = jmdictReader(knownEnglish([wiktionary, ejdict], wiktionary.phrases, frequency))
  yield* eachJmdictEntry(options.jmdict, reader.add)
  const jmdict = reader.finish()

  let entries = toEntries(mergeSources({ wiktionary, ejdict, jmdict, frequency }), frequency, existing)
  if (options.commonOnly) entries = entries.filter((entry) => entry.common)
  if (options.limit !== undefined) entries = entries.slice(0, options.limit)
  return entries
})

/**
 * Builds the English dictionary from its sources and loads it alongside JMDict. Re-importing
 * updates words in place, keeping their ids, so enrichment and saved words survive.
 */
export const importFiles = Effect.fn("Eiwa.importFiles")(function* (options: ImportOptions) {
  const repo = yield* DictionaryRepo
  const existing = yield* repo.headwordIds("en")
  const entries: ReadonlyArray<EntryRecord & { readonly source: Source }> = yield* build(options, existing)

  yield* repo.saveTags(ENGLISH_TAGS)
  const batchSize = options.batchSize ?? 500
  for (let start = 0; start < entries.length; start += batchSize) {
    yield* repo.insertEntries(entries.slice(start, start + batchSize))
    if (start % 20_000 < batchSize && start > 0) yield* Effect.logInfo(`Imported ${start} English words`)
  }

  // Words the sources no longer have, or that are now another word's inflection ("ate"), go,
  // with their enrichment; a partial import leaves the rest of the dictionary alone.
  const complete = !options.commonOnly && options.limit === undefined
  const imported = new Set(entries.map((entry) => entry.headword))
  const stale = complete ? [...existing].filter(([headword]) => !imported.has(headword)).map(([, id]) => id) : []
  yield* repo.deleteEntries(stale)

  const bySource = (source: Source) => entries.filter((entry) => entry.source === source).length
  return {
    removed: stale.length,
    entries: entries.length,
    wiktionary: bySource("wiktionary"),
    ejdict: bySource("ejdict"),
    jmdict: bySource("jmdict")
  }
})
