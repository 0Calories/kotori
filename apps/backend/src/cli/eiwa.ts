import { Claude, GOLDEN_ENGLISH_PAIRS, GOLDEN_ENGLISH_SENSES, GOLDEN_LOANS } from "@kotori/ai"
import { Console, Effect, FileSystem, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { FetchHttpClient, HttpClient } from "effect/http"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { consolidateBatch } from "../features/dictionary/import/eiwa/consolidate.ts"
import { eachLine, readLines } from "../features/dictionary/import/eiwa/Eiwa.ts"
import { parseFrequency } from "../features/dictionary/import/eiwa/frequency.ts"
import {
  enwiktionaryParser,
  kaikkiWordUrl,
  parseEnWiktionary,
  type RawEnWord,
  wiktionaryParser
} from "../features/dictionary/import/eiwa/wiktionary.ts"
import { workspaceRoot } from "../runtime/Paths.ts"

const data = (path: string) => join(workspaceRoot, "data", path)

/** Core modern slang and idioms always included alongside the golden set when `--golden` is passed. */
export const CORE_SLANG_AND_IDIOMS: ReadonlyArray<string> = [
  "keep it real",
  "twerk",
  "ghost",
  "salty",
  "cap",
  "no cap",
  "rizz",
  "slay",
  "kid",
  "under the weather",
  "hang out",
  "goat",
  "GOAT"
]

export const goldenEnglishWords = (): Array<string> => [
  ...new Set([
    ...GOLDEN_ENGLISH_SENSES.map((g) => g.word),
    ...GOLDEN_ENGLISH_PAIRS.flatMap((p) => [p.word, p.similar]),
    ...GOLDEN_LOANS.map((l) => l.word),
    ...CORE_SLANG_AND_IDIOMS
  ])
]

const chunk = <A>(items: ReadonlyArray<A>, size: number): Array<Array<A>> => {
  const chunks: Array<Array<A>> = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export const eiwa = Command.make(
  "eiwa",
  {
    words: Flag.String("words").pipe(
      Flag.withDescription("Comma-separated English headwords or phrases to fetch from Kaikki and consolidate"),
      Flag.optional
    ),
    golden: Flag.Boolean("golden").pipe(
      Flag.withDescription("Include all golden-set English words and core slang/idioms"),
      Flag.withDefault(false)
    ),
    source: Flag.String("source").pipe(
      Flag.withDescription("Read raw enwiktionary JSONL (.jsonl or .jsonl.gz) from disk instead of fetching per-word from Kaikki"),
      Flag.optional
    ),
    output: Flag.String("output").pipe(
      Flag.withDescription("Output JSONL path (defaults to data/eiwa/enwiktionary-ja.jsonl)"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Maximum number of untranslated headwords to consolidate in this run"),
      Flag.withDefault(200)
    ),
    batchSize: Flag.Int("batch-size").pipe(
      Flag.withDescription("Number of headwords per Claude consolidation call"),
      Flag.withDefault(12)
    ),
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withDescription("Number of batches consolidated in parallel"),
      Flag.withDefault(3)
    ),
    overwrite: Flag.Boolean("overwrite").pipe(
      Flag.withDescription("Re-consolidate words even if already present in data/eiwa/enwiktionary-ja.jsonl"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ words: wordsFlag, golden: includeGolden, source, output, limit, batchSize, concurrency, overwrite }) {
    const fs = yield* FileSystem.FileSystem
    const outPath = Option.getOrElse(output, () => data("eiwa/enwiktionary-ja.jsonl"))
    if (Option.isNone(output)) {
      yield* fs.makeDirectory(data("eiwa"), { recursive: true })
    }

    const existingParser = wiktionaryParser()
    if (yield* fs.exists(outPath)) {
      yield* eachLine(outPath, existingParser.add)
    }
    const existingWords = new Set(existingParser.finish().words.map((w) => w.headword))

    const requested = new Set<string>()
    if (includeGolden) {
      for (const w of goldenEnglishWords()) requested.add(w)
    }
    if (Option.isSome(wordsFlag)) {
      for (const w of wordsFlag.value.split(",").map((s) => s.trim()).filter(Boolean)) {
        requested.add(w)
      }
    }

    let rawWords: Array<RawEnWord> = []
    if (Option.isSome(source)) {
      const parser = enwiktionaryParser()
      yield* eachLine(source.value, parser.add)
      const parsed = parser.finish().words
      const freqPath = data("eiwa/en_50k.txt")
      const frequency = (yield* fs.exists(freqPath)) ? parseFrequency(yield* readLines(freqPath)) : new Map<string, number>()
      const filtered = parsed.filter(
        (w) => (overwrite || !existingWords.has(w.headword)) && (requested.size === 0 || requested.has(w.headword))
      )
      rawWords = filtered
        .toSorted((a, b) => (frequency.get(b.headword.toLowerCase()) ?? 0) - (frequency.get(a.headword.toLowerCase()) ?? 0))
        .slice(0, limit)
    } else {
      const targets = [...requested].filter((w) => overwrite || !existingWords.has(w)).slice(0, limit)
      if (targets.length === 0) {
        yield* Console.log(
          requested.size === 0
            ? "Pass --words <list>, --golden, or --source <kaikki-enwiktionary.jsonl.gz>."
            : `All ${requested.size} requested headwords are already in ${outPath}.`
        )
        return
      }
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      yield* Console.log(`Fetching ${targets.length} headwords from Kaikki (enwiktionary)…`)
      const fetchedLines = yield* Effect.forEach(
        targets,
        (word) =>
          client.get(kaikkiWordUrl(word)).pipe(
            Effect.flatMap((res) => res.text),
            Effect.map((text) => text.trim().split("\n").filter(Boolean)),
            Effect.catchCause((cause) =>
              Effect.logWarning(`Could not fetch "${word}" from Kaikki`, cause).pipe(Effect.as([] as Array<string>))
            )
          ),
        { concurrency: 8 }
      )
      const initialParsed = parseEnWiktionary(fetchedLines.flat())
      const redirectBases = new Map<string, string>()
      for (const w of targets) {
        const redirect = initialParsed.formsOf.find((f) => f.text === w && f.tags.length === 0 && !targets.includes(f.base))
        if (redirect !== undefined) redirectBases.set(w, redirect.base)
      }
      const baseLines =
        redirectBases.size === 0
          ? []
          : yield* Effect.forEach(
              [...new Set(redirectBases.values())],
              (base) =>
                client.get(kaikkiWordUrl(base)).pipe(
                  Effect.flatMap((res) => res.text),
                  Effect.map((text) => text.trim().split("\n").filter(Boolean)),
                  Effect.catchCause(() => Effect.succeed([] as Array<string>))
                ),
              { concurrency: 4 }
            )
      const parsedFetched = parseEnWiktionary([...fetchedLines.flat(), ...baseLines.flat()])
      const byHeadword = new Map(parsedFetched.words.map((w) => [w.headword, w]))
      for (const [target, base] of redirectBases) {
        if (!byHeadword.has(target)) {
          const baseWord = byHeadword.get(base)
          if (baseWord !== undefined) {
            const keepTargetHeadword = goldenEnglishWords().includes(target)
            if (keepTargetHeadword) {
              byHeadword.set(target, {
                ...baseWord,
                headword: target,
                spellings: [...new Set([base, ...baseWord.spellings.filter((s) => s !== target)])]
              })
            } else {
              byHeadword.set(target, baseWord)
            }
          }
        }
      }
      const seenHeadwords = new Set<string>()
      rawWords = []
      for (const w of targets) {
        const resolved = byHeadword.get(w)
        if (resolved !== undefined && !seenHeadwords.has(resolved.headword)) {
          seenHeadwords.add(resolved.headword)
          rawWords.push(resolved)
        }
      }
    }

    if (rawWords.length === 0) {
      yield* Console.log("No untranslated headwords to process.")
      return
    }

    const batches = chunk(rawWords, batchSize)
    yield* Console.log(
      `Consolidating ${rawWords.length} English headwords across ${batches.length} batches (batchSize=${batchSize}, concurrency=${concurrency})…`
    )

    let written = 0
    let failed = 0
    yield* Effect.forEach(
      batches,
      (batch, idx) =>
        consolidateBatch(batch).pipe(
          Effect.tap((consolidated) =>
            Effect.sync(() => {
              if (consolidated.length > 0) {
                const lines = consolidated.map((item) => JSON.stringify(item)).join("\n") + "\n"
                appendFileSync(outPath, lines, "utf8")
                written += consolidated.length
              }
            })
          ),
          Effect.tap((consolidated) =>
            Effect.logInfo(`Batch ${idx + 1}/${batches.length}: consolidated ${consolidated.length}/${batch.length} words`)
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning(`Batch ${idx + 1}/${batches.length} failed`, cause).pipe(
              Effect.tap(() => Effect.sync(() => (failed += batch.length)))
            )
          )
        ),
      { concurrency, discard: true }
    )

    // Deduplicate in-place if `--overwrite` was used so the latest version of each headword wins.
    if (overwrite && (yield* fs.exists(outPath))) {
      const lines = (yield* fs.readFileString(outPath)).trim().split("\n").filter(Boolean)
      const latest = new Map<string, string>()
      for (const line of lines) {
        const headword = (JSON.parse(line) as { headword: string }).headword
        latest.set(headword, line)
      }
      yield* fs.writeFileString(outPath, `${[...latest.values()].join("\n")}\n`)
    }

    yield* Console.log(`Done: wrote ${written} consolidated words to data/eiwa/enwiktionary-ja.jsonl (${failed} failed).`)
  })
).pipe(
  Command.withDescription(
    "Fetch and consolidate English Wiktionary entries into Japanese learner senses (data/eiwa/enwiktionary-ja.jsonl)"
  ),
  Command.provide(Claude.layer),
  Command.provide(FetchHttpClient.layer)
)
