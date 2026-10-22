import { DictionaryRepo, type EntryRecord, resolveFromRoot } from "@kotori/db"
import { Effect, FileSystem, Path, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"
import { gunzipSync } from "node:zlib"
import { parseEntries, parseTags } from "./parse.ts"

/** EDRDG's English-only JMdict, refreshed daily. Licensed CC BY-SA 4.0. */
export const JMDICT_URL = "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz"

export class JMDictError extends Schema.TaggedError<JMDictError>()("JMDictError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/** Downloads JMdict_e.gz into its own directory, returning the file path. */
export const download = Effect.fn("JMDict.download")(
  function* (directory: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

    const target = path.join(resolveFromRoot(directory), "JMdict_e.gz")
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* Effect.logInfo(`Downloading ${JMDICT_URL}`)
    const response = yield* client.get(JMDICT_URL)
    yield* response.stream.pipe(Stream.run(fs.sink(target)))
    return target
  },
  Effect.mapError((cause) => new JMDictError({ message: "Could not download JMDict", cause }))
)

export interface ImportOptions {
  /** Path to JMdict_e.gz (or an uncompressed JMdict XML file). */
  readonly file: string
  /** Stop after this many entries, for quick local setups. */
  readonly limit?: number | undefined
  /** Only import entries JMDict marks as common (~22k words). */
  readonly commonOnly?: boolean | undefined
  readonly batchSize?: number | undefined
}

/** Parses JMDict and loads it into the database, then rebuilds the gloss search index. */
export const importFile = Effect.fn("JMDict.importFile")(function* (options: ImportOptions) {
  const fs = yield* FileSystem.FileSystem
  const repo = yield* DictionaryRepo

  const bytes = yield* fs
    .readFile(resolveFromRoot(options.file))
    .pipe(Effect.mapError((cause) => new JMDictError({ message: `Could not read ${options.file}`, cause })))
  const xml = yield* Effect.try({
    try: () => (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes)).toString("utf8"),
    catch: (cause) => new JMDictError({ message: "Could not decompress JMDict", cause })
  })

  const tags = parseTags(xml)
  yield* repo.replaceTags(tags)
  yield* Effect.logInfo(`Loaded ${tags.length} JMDict tags`)

  const batchSize = options.batchSize ?? 500
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  let batch: Array<EntryRecord> = []
  let imported = 0

  for (const entry of parseEntries(xml)) {
    if (imported >= limit) break
    if (options.commonOnly && !entry.common) continue
    batch.push(entry)
    imported++
    if (batch.length >= batchSize) {
      yield* repo.insertEntries(batch)
      batch = []
      if (imported % 20_000 < batchSize) yield* Effect.logInfo(`Imported ${imported} entries`)
    }
  }
  yield* repo.insertEntries(batch)
  yield* Effect.logInfo(`Imported ${imported} entries; rebuilding search index`)
  yield* repo.rebuildSearchIndex
  return { entries: imported, tags: tags.length }
})
