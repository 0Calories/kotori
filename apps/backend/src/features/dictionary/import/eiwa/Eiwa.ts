import { normalizeGloss } from "@kotori/language"
import { Effect, FileSystem, Path, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"
import { createReadStream, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { createGunzip } from "node:zlib"
import { Database } from "../../../../db/Database.ts"
import { resolveFromRoot } from "../../../../runtime/Paths.ts"
import { deleteEntries, headwordIds, insertEntries, linkLoans, saveKotoriPitfalls, saveTags } from "../../queries.ts"
import { entrySplitter } from "../jmdict/parse.ts"
import type { ImportEntry } from "../seedFacts.ts"
import { APPROVED_EN_FILE, parseApproved } from "./approved.ts"
import { mergeSources, type Source, toEntries } from "./build.ts"
import { parseFamiliarity } from "./familiarity.ts"
import { FREQUENCY_URL, parseFrequency } from "./frequency.ts"
import { jmdictReader, type KnownEnglish } from "./jmdict.ts"
import { ENGLISH_TAGS } from "./tags.ts"
import { curatedParser, parsePhraseIndex, WIKTIONARY_URL, wiktionaryParser } from "./wiktionary.ts"
import { addRedirect, type FormOf, type Word } from "./words.ts"

export class EiwaError extends Schema.TaggedError<EiwaError>()("EiwaError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/** The downloaded and curated sources, as paths relative to the repo root or absolute. */
export interface Files {
  /** Curated English Wiktionary entries with Japanese glosses (`enwiktionary-ja.jsonl`), optional in tests. */
  readonly curated?: string | undefined
  /** Attested multi-word phrases and variant redirects (`enwiktionary-phrases.json`), optional in tests. */
  readonly phrases?: string | undefined
  /** Familiarity ratings for phrases the other sources don't rate (`familiarity.json`), optional in tests. */
  readonly familiarity?: string | undefined
  /** Entries and aliases approved out of Ask Kotori proposals (`data/approved/en.jsonl`). */
  readonly approved?: string | undefined
  /** Wiktextract's extraction of Japanese Wiktionary, gzipped JSON lines (or plain). */
  readonly wiktionary: string
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
      curated: path.join(root, "enwiktionary-ja.jsonl"),
      phrases: path.join(root, "enwiktionary-phrases.json"),
      familiarity: path.join(root, "familiarity.json"),
      approved: resolveFromRoot(APPROVED_EN_FILE),
      wiktionary: path.join(root, "ja-wiktionary.jsonl.gz"),
      frequency: path.join(root, "en_50k.txt")
    }
    if (!(yield* fs.exists(files.wiktionary))) {
      yield* Effect.logInfo(`Downloading ${WIKTIONARY_URL}`)
      yield* (yield* client.get(WIKTIONARY_URL)).stream.pipe(Stream.run(fs.sink(files.wiktionary)))
    }
    if (!(yield* fs.exists(files.frequency))) {
      yield* Effect.logInfo(`Downloading ${FREQUENCY_URL}`)
      yield* fs.writeFileString(files.frequency, yield* Effect.flatMap(client.get(FREQUENCY_URL), (r) => r.text))
    }
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
const eachJmdictEntry = (file: string, read: (entry: ImportEntry) => void) =>
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
  frequency: ReadonlyMap<string, number>,
  redirects?: ReadonlyMap<string, string>
): KnownEnglish => {
  const words = new Set<string>()
  const verbs = new Set<string>()
  const allPhrases = new Set<string>(phrases)
  const allRedirects = new Map<string, string>(redirects)
  for (const source of sources) {
    for (const word of source.words) {
      for (const text of [word.headword, ...word.spellings, ...word.inflections.map((form) => form.text)]) {
        words.add(text.toLowerCase())
      }
      const canonical = word.headword.toLowerCase()
      if (canonical.includes(" ")) {
        allPhrases.add(canonical)
        for (const spelling of word.spellings) {
          if (!allRedirects.has(normalizeGloss(spelling))) addRedirect(allRedirects, spelling, canonical)
        }
      }
      if (word.senses.some((sense) => sense.pos.includes("v"))) verbs.add(canonical)
    }
    for (const form of source.formsOf) words.add(form.text.toLowerCase())
  }
  return { words, verbs, phrases: allPhrases, redirects: allRedirects, frequency }
}

export interface ImportOptions {
  readonly files: Files
  /** JMdict_e_examp.gz (or JMdict_e.gz, or uncompressed XML), read backwards for words the other sources lack. */
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
  const curatedReader = curatedParser()
  const curatedPath = options.files.curated
  if (curatedPath !== undefined && existsSync(resolveFromRoot(curatedPath))) {
    yield* eachLine(curatedPath, curatedReader.add)
  }
  const curated = curatedReader.finish()

  // Approved Ask Kotori entries read as curated words too, after them: on a clash, curation wins.
  const approvedPath = options.files.approved
  const approved =
    approvedPath !== undefined && existsSync(resolveFromRoot(approvedPath))
      ? parseApproved(yield* readLines(approvedPath))
      : { words: [], formsOf: [] }
  const curatedHeadwords = new Set(curated.words.map((word) => word.headword.toLowerCase()))
  curated.words.push(...approved.words.filter((word) => !curatedHeadwords.has(word.headword.toLowerCase())))
  curated.formsOf.push(...approved.formsOf)

  const phrasesPath = options.files.phrases
  const phraseIndex =
    phrasesPath !== undefined && existsSync(resolveFromRoot(phrasesPath))
      ? parsePhraseIndex((yield* readLines(phrasesPath)).join("\n"))
      : { phrases: new Set<string>(), redirects: new Map<string, string>() }

  const familiarityPath = options.files.familiarity
  const ratings =
    familiarityPath !== undefined && existsSync(resolveFromRoot(familiarityPath))
      ? parseFamiliarity((yield* readLines(familiarityPath)).join("\n"))
      : new Map<string, number>()

  const parser = wiktionaryParser()
  yield* eachLine(options.files.wiktionary, parser.add)
  const wiktionary = parser.finish()
  const frequency = parseFrequency(yield* readLines(options.files.frequency))
  yield* Effect.logInfo(`Read ${curated.words.length} curated words and ${wiktionary.words.length} from Wiktionary`)

  const phrases = new Set([...wiktionary.phrases, ...phraseIndex.phrases])
  const reader = jmdictReader(knownEnglish([curated, wiktionary], phrases, frequency, phraseIndex.redirects))
  yield* eachJmdictEntry(options.jmdict, reader.add)
  const jmdict = { words: reader.finish(), formsOf: reader.formsOf() }

  let entries = toEntries(
    mergeSources({ curated, wiktionary, jmdict, frequency }),
    frequency,
    existing,
    reader.backTranslations(),
    ratings
  )
  if (options.commonOnly) entries = entries.filter((entry) => entry.common)
  if (options.limit !== undefined) entries = entries.slice(0, options.limit)
  // Approved words' pitfalls, by headword; a curated word of the same headword took its place.
  const pitfalls = new Map(approved.words.map((word) => [word.headword, word.pitfalls ?? []] as const))
  return { entries, pitfalls }
})

/**
 * Builds the English dictionary from its sources and loads it alongside JMDict. Re-importing
 * updates words in place, keeping their ids, so enrichment and saved words survive.
 */
export const importFiles = Effect.fn("Eiwa.importFiles")(function* (options: ImportOptions) {
  const db = yield* Database
  const existing = yield* headwordIds(db, "en")
  const built = yield* build(options, existing)
  const entries: ReadonlyArray<ImportEntry & { readonly source: Source }> = built.entries

  yield* saveTags(db, ENGLISH_TAGS)
  const batchSize = options.batchSize ?? 500
  for (let start = 0; start < entries.length; start += batchSize) {
    yield* insertEntries(db, entries.slice(start, start + batchSize), { seeded: true })
    if (start % 20_000 < batchSize && start > 0) yield* Effect.logInfo(`Imported ${start} English words`)
  }

  // Words the sources no longer have, or that are now another word's inflection ("ate"), go,
  // with their enrichment; a partial import leaves the rest of the dictionary alone.
  const complete = !options.commonOnly && options.limit === undefined
  const imported = new Set(entries.map((entry) => entry.headword))
  const stale = complete ? [...existing].filter(([headword]) => !imported.has(headword)).map(([, id]) => id) : []
  yield* deleteEntries(db, stale)
  for (const entry of entries) {
    const drafted = entry.dictionary === "kotori" ? built.pitfalls.get(entry.headword) : undefined
    if (drafted !== undefined) yield* saveKotoriPitfalls(db, entry.id, "en", drafted)
  }
  yield* linkLoans(db)

  const bySource = (source: Source) => entries.filter((entry) => entry.source === source).length
  return {
    removed: stale.length,
    entries: entries.length,
    curated: bySource("curated"),
    wiktionary: bySource("wiktionary"),
    jmdict: bySource("jmdict")
  }
})
