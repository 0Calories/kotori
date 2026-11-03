import type { EntryRecord } from "@kotori/contracts"
import { Effect, FileSystem, Path, Schema } from "effect"
import { HttpClient } from "effect/http"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { createGunzip } from "node:zlib"
import { Database } from "../../../../db/Database.ts"
import { resolveFromRoot } from "../../../../runtime/Paths.ts"
import { deleteEntries, headwordIds, insertEntries, saveTags } from "../../queries.ts"
import { mergeSources, toEntries } from "./build.ts"
import { FREQUENCY_URL, parseFrequency } from "./frequency.ts"
import { ENGLISH_TAGS } from "./tags.ts"
import { wiktionaryParser } from "./wiktionary.ts"

export class EiwaError extends Schema.TaggedError<EiwaError>()("EiwaError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/** The English dictionary's sources, as paths relative to the repo root or absolute. */
export interface Files {
  /** Consolidated English Wiktionary entries with Japanese glosses (`enwiktionary-ja.jsonl`). */
  readonly wiktionary: string
  /** FrequencyWords' English list (`en_50k.txt`). */
  readonly frequency: string
}

export const defaultFiles = (directory = "data/eiwa"): Files => {
  const root = resolveFromRoot(directory)
  return {
    wiktionary: `${root}/enwiktionary-ja.jsonl`,
    frequency: `${root}/en_50k.txt`
  }
}

/** Ensures the English dictionary's frequency list is present in `directory` and returns its source paths. */
export const download = Effect.fn("Eiwa.download")(
  function* (directory: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = resolveFromRoot(directory)
    yield* fs.makeDirectory(root, { recursive: true })

    const files: Files = {
      wiktionary: path.join(root, "enwiktionary-ja.jsonl"),
      frequency: path.join(root, "en_50k.txt")
    }
    if (!(yield* fs.exists(files.frequency))) {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      yield* Effect.logInfo(`Downloading ${FREQUENCY_URL}`)
      yield* fs.writeFileString(files.frequency, yield* Effect.flatMap(client.get(FREQUENCY_URL), (r) => r.text))
    }
    return files
  },
  Effect.mapError((cause) => new EiwaError({ message: "Could not download the English dictionary", cause }))
)

/** Feeds each line of a text file, gzipped or not, to `read`, streaming it rather than loading it whole. */
export const eachLine = (file: string, read: (line: string) => void) =>
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

export const readLines = (file: string) =>
  Effect.suspend(() => {
    const lines: Array<string> = []
    return Effect.as(
      eachLine(file, (line) => lines.push(line)),
      lines
    )
  })

export interface ImportOptions {
  readonly files: Files
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
  const frequency = parseFrequency(yield* readLines(options.files.frequency))
  yield* Effect.logInfo(`Read ${wiktionary.words.length} consolidated words from English Wiktionary`)

  let entries = toEntries(mergeSources({ wiktionary }), frequency, existing)
  if (options.commonOnly) entries = entries.filter((entry) => entry.common)
  if (options.limit !== undefined) entries = entries.slice(0, options.limit)
  return entries
})

/**
 * The English dictionary's entries as a fresh import would number them, built from its sources
 * without a database: for tools that cut fixtures from it, such as the golden set's.
 */
export const buildEntries = (options: ImportOptions) => build(options, new Map())

/**
 * Builds the English dictionary from its sources and loads it alongside JMDict. Re-importing
 * updates words in place, keeping their ids, so enrichment and saved words survive.
 */
export const importFiles = Effect.fn("Eiwa.importFiles")(function* (options: ImportOptions) {
  const db = yield* Database
  const existing = yield* headwordIds(db, "en")
  const entries: ReadonlyArray<EntryRecord> = yield* build(options, existing)

  yield* saveTags(db, ENGLISH_TAGS)
  const batchSize = options.batchSize ?? 500
  for (let start = 0; start < entries.length; start += batchSize) {
    yield* insertEntries(db, entries.slice(start, start + batchSize))
    if (start % 20_000 < batchSize && start > 0) yield* Effect.logInfo(`Imported ${start} English words`)
  }

  // Words the sources no longer have, or that are now another word's inflection ("ate"), go,
  // with their enrichment; a partial import leaves the rest of the dictionary alone.
  const complete = !options.commonOnly && options.limit === undefined
  const imported = new Set(entries.map((entry) => entry.headword))
  const stale = complete ? [...existing].filter(([headword]) => !imported.has(headword)).map(([, id]) => id) : []
  yield* deleteEntries(db, stale)

  return {
    removed: stale.length,
    entries: entries.length
  }
})
