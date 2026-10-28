import { Effect, FileSystem, Path, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"
import { gunzipSync } from "node:zlib"

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

    const target = path.join(directory, "JMdict_e.gz")
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* Effect.logInfo(`Downloading ${JMDICT_URL}`)
    const response = yield* client.get(JMDICT_URL)
    yield* response.stream.pipe(Stream.run(fs.sink(target)))
    return target
  },
  Effect.mapError((cause) => new JMDictError({ message: "Could not download JMDict", cause }))
)

/** The XML of a JMdict file: JMdict_e.gz as EDRDG publishes it, or uncompressed. */
export const read = Effect.fn("JMDict.read")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  const bytes = yield* fs
    .readFile(file)
    .pipe(Effect.mapError((cause) => new JMDictError({ message: `Could not read ${file}`, cause })))
  return yield* Effect.try({
    try: () => (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes)).toString("utf8"),
    catch: (cause) => new JMDictError({ message: "Could not decompress JMDict", cause })
  })
})
