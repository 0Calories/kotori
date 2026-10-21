import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Claude, ClaudeError } from "@kotori/ai"
import {
  DatabaseLive,
  DictionaryRepo,
  fuse,
  isSingleLatinWord,
  Repositories,
  SCORE_THRESHOLD,
  shouldFallback,
  SituationRepo,
  type VectorHit
} from "@kotori/db"
import type { EntrySummary } from "@kotori/domain"
import { Jev, JevError } from "@kotori/nuance"
import { Pronouncer, TtsError } from "@kotori/tts"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { mkdirSync, writeFileSync } from "node:fs"
import { Dictionary } from "../../apps/api/src/services/Dictionary.ts"
import { Situations } from "../../apps/api/src/services/Situations.ts"
import { corpus } from "./corpus.ts"
import { queries, type LabeledQuery, type QueryKind } from "./queries.ts"

const LIMIT = 20
const MISS_RANK = LIMIT + 1

const Offline = Layer.mergeAll(
  Layer.succeed(Claude, Claude.of({
    model: "test",
    available: Effect.succeed(false),
    generate: () => Effect.fail(new ClaudeError({ reason: "unconfigured", message: "not configured" }))
  })),
  Layer.succeed(Jev, Jev.of({
    configured: false,
    model: "test",
    ask: () => Effect.fail(new JevError({ message: "not configured" }))
  })),
  Layer.succeed(Pronouncer, Pronouncer.of({
    configured: false,
    speak: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not configured" })),
    enrichEntry: () => Effect.succeed({ clips: 0, characters: 0 })
  }))
)

const EvalLive = Situations.layer.pipe(
  Layer.provideMerge(Dictionary.layer),
  Layer.provide(Offline),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(NodeServices.layer)
)

const aliasSet = new Set(corpus.flatMap((situation) => [
  situation.title.toLowerCase(),
  ...situation.aliases.map((alias) => alias.toLowerCase())
]))

const percentile = (values: readonly number[], p: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]!
}

const rankOf = (ids: readonly string[], expected: string | null) => {
  if (expected === null) return null
  const index = ids.indexOf(expected)
  return index === -1 ? null : index + 1
}

interface Scored {
  readonly query: LabeledQuery
  readonly exactAlias: boolean
  readonly dictionaryRank: number | null
  readonly keywordRank: number | null
  readonly vectorRank: number | null
  readonly hybridRank: number | null
  readonly topScore: number
  readonly topId: string | null
  readonly topCosine: number | null
  readonly keywordIds: readonly string[]
  readonly vectorIds: readonly string[]
  readonly hybridIds: readonly string[]
  readonly dictionaryHeadwords: readonly string[]
}

const summarize = (rows: readonly Scored[], rank: (row: Scored) => number | null) => {
  const labeled = rows.filter((row) => rank(row) !== undefined)
  const ranks = labeled.flatMap((row) => {
    const value = rank(row)
    return value === null ? [] : [value]
  })
  const applicable = labeled.length
  const missed = applicable - ranks.length
  const hits = ranks.filter((value) => value <= 5).length
  const mean = ranks.length === 0 ? null : ranks.reduce((sum, value) => sum + value, 0) / ranks.length
  const mrr = applicable === 0
    ? null
    : labeled.reduce((sum, row) => {
      const value = rank(row)
      return sum + (value === null ? 0 : 1 / value)
    }, 0) / applicable
  const penalized = applicable === 0
    ? null
    : labeled.reduce((sum, row) => sum + (rank(row) ?? MISS_RANK), 0) / applicable
  return {
    n: applicable,
    hitAt5: applicable === 0 ? null : hits / applicable,
    meanRank: mean,
    meanRankWithMisses: penalized,
    missed,
    mrr
  }
}

const fmt = (value: number | null, digits = 3) => value === null ? "  n/a" : value.toFixed(digits)
const pct = (value: number | null) => value === null ? "  n/a" : `${(value * 100).toFixed(1)}%`

const KINDS: readonly QueryKind[] = ["verbatim", "paraphrase", "typo", "japanese", "lexical", "uncovered"]

const program = Effect.gen(function*() {
  const situations = yield* Situations
  const dictionary = yield* Dictionary
  const repo = yield* SituationRepo
  const entries = yield* DictionaryRepo
  const sql = yield* SqlClient.SqlClient

  const indexed = yield* repo.count
  if (indexed === 0) {
    console.error("No situations indexed. Run pnpm situations:index after pnpm seed.")
    return
  }
  yield* sql`DELETE FROM situation_misses`

  const records = yield* repo.all
  const byId = new Map(records.map((record) => [record.id, record]))
  const linkedIds = [...new Set(records.flatMap((record) => [...record.entryIds]))]
  const linkedEntries = yield* entries.getEntries(linkedIds)
  const entryById = new Map(linkedEntries.map((entry) => [entry.id, entry]))

  const acceptable = (query: LabeledQuery) => {
    const ids = new Set<number>()
    const words = new Set(query.headwords)
    const situation = query.situation === null ? undefined : byId.get(query.situation)
    if (situation !== undefined) {
      for (const id of situation.entryIds) {
        ids.add(id)
        const entry = entryById.get(id)
        if (entry !== undefined) {
          words.add(entry.headword)
          words.add(entry.reading)
        }
      }
    }
    return { ids, words }
  }

  const dictionaryRank = (result: readonly EntrySummary[], query: LabeledQuery) => {
    const { ids, words } = acceptable(query)
    if (ids.size === 0 && words.size === 0) return null
    const index = result.findIndex((entry) =>
      ids.has(entry.id) || words.has(entry.headword) || words.has(entry.reading)
    )
    return index === -1 ? null : index + 1
  }

  // Warm the embedding model and the sqlite pages before timing.
  const warmStart = performance.now()
  yield* situations.search(queries[0]!.query, 5)
  const warmMs = performance.now() - warmStart
  yield* sql`DELETE FROM situation_misses`

  const time = <A>(effect: Effect.Effect<A>) =>
    Effect.gen(function*() {
      const start = performance.now()
      const value = yield* effect
      return { value, ms: performance.now() - start }
    })

  const dictionaryTimed = []
  for (const query of queries) dictionaryTimed.push(yield* time(dictionary.search(query.query, LIMIT)))
  const keywordTimed = []
  for (const query of queries) keywordTimed.push(yield* time(situations.keyword(query.query)))
  const vectorTimed = []
  for (const query of queries) vectorTimed.push(yield* time(situations.vector(query.query)))
  const hybridTimed = []
  for (const query of queries) {
    hybridTimed.push(yield* time(Effect.gen(function*() {
      const [keywordIds, vectorHits] = yield* Effect.all([
        situations.keyword(query.query),
        situations.vector(query.query)
      ], { concurrency: "unbounded" })
      return fuse(keywordIds, vectorHits)
    })))
  }
  const pathTimed = []
  for (const query of queries) pathTimed.push(yield* time(situations.search(query.query, LIMIT)))

  const rows: Scored[] = queries.map((query, index) => {
    const keywordIds = keywordTimed[index]!.value
    const vectorIds = (vectorTimed[index]!.value as readonly VectorHit[]).map((hit) => hit.id)
    const fused = hybridTimed[index]!.value
    const dictionaryEntries = dictionaryTimed[index]!.value.entries
    const top = fused[0]
    return {
      query,
      exactAlias: aliasSet.has(query.query.toLowerCase().trim()),
      dictionaryRank: dictionaryRank(dictionaryEntries, query),
      keywordRank: rankOf(keywordIds, query.situation),
      vectorRank: rankOf(vectorIds, query.situation),
      hybridRank: rankOf(fused.map((hit) => hit.id), query.situation),
      topScore: top?.score ?? 0,
      topId: top?.id ?? null,
      topCosine: top?.cosine ?? null,
      keywordIds,
      vectorIds,
      hybridIds: fused.map((hit) => hit.id),
      dictionaryHeadwords: dictionaryEntries.slice(0, 5).map((entry) => entry.headword)
    }
  })

  const methods = [
    ["dictionary", (row: Scored) => row.dictionaryRank, dictionaryTimed.map((row) => row.ms)],
    ["keyword", (row: Scored) => row.keywordRank, keywordTimed.map((row) => row.ms)],
    ["vector", (row: Scored) => row.vectorRank, vectorTimed.map((row) => row.ms)],
    ["hybrid", (row: Scored) => row.hybridRank, hybridTimed.map((row) => row.ms)]
  ] as const

  console.log(`Situations: ${indexed}. Vector backend: ${yield* repo.vectorBackend}. Queries: ${queries.length}.`)
  console.log(`Model warmup (first situation search): ${warmMs.toFixed(0)} ms.`)
  console.log("")
  console.log("method      hit@5   meanRank  meanRank+miss    missed    MRR     p50 ms   p95 ms")
  for (const [name, pick, times] of methods) {
    const applicable = rows.filter((row) => pick(row) !== null || row.query.situation !== null || row.query.headwords.length > 0)
    const stats = summarize(
      name === "dictionary"
        ? rows.filter((row) => row.query.situation !== null || row.query.headwords.length > 0)
        : rows.filter((row) => row.query.situation !== null),
      (row) => name === "dictionary" ? row.dictionaryRank : pick(row)
    )
    console.log(
      `${name.padEnd(10)}  ${pct(stats.hitAt5).padStart(6)}  ${fmt(stats.meanRank, 2).padStart(8)}  ${
        fmt(stats.meanRankWithMisses, 2).padStart(13)
      }  ${String(stats.missed).padStart(4)}/${String(stats.n).padStart(2)}  ${fmt(stats.mrr, 3).padStart(6)}  ${
        percentile(times, 50).toFixed(1).padStart(7)
      }  ${percentile(times, 95).toFixed(1).padStart(7)}`
    )
    void applicable
  }
  const pathTimes = pathTimed.map((row) => row.ms)
  console.log(
    `${"parallel".padEnd(10)}  ${" ".repeat(48)}${percentile(pathTimes, 50).toFixed(1).padStart(7)}  ${
      percentile(pathTimes, 95).toFixed(1).padStart(7)
    }`
  )

  console.log("\nBy kind (hit@5 / mean rank of hits / missed)")
  console.log("kind         n   dictionary          keyword             vector              hybrid")
  for (const kind of KINDS) {
    const subset = rows.filter((row) => row.query.kind === kind)
    const cells = [
      summarize(subset.filter((row) => row.query.situation !== null || row.query.headwords.length > 0), (row) => row.dictionaryRank),
      summarize(subset.filter((row) => row.query.situation !== null), (row) => row.keywordRank),
      summarize(subset.filter((row) => row.query.situation !== null), (row) => row.vectorRank),
      summarize(subset.filter((row) => row.query.situation !== null), (row) => row.hybridRank)
    ].map((stats) => `${pct(stats.hitAt5)} ${fmt(stats.meanRank, 1)} m${stats.missed}`)
    console.log(`${kind.padEnd(12)} ${String(subset.length).padStart(2)}  ${cells.map((cell) => cell.padEnd(18)).join(" ")}`)
  }

  const threshold = situations.threshold
  const decided = rows.map((row) => ({ ...row, fallback: shouldFallback(row.query.query, row.topScore) }))
  const want = (row: Scored) => row.query.wantFallback
  const confidentCorrect = decided.filter((row) =>
    !want(row) && !row.fallback && row.hybridRank === 1
  ).length
  const inCatalog = decided.filter((row) => !want(row))
  const negatives = decided.filter((row) => want(row))
  const falseAccept = negatives.filter((row) => !row.fallback)
  const missedAccept = inCatalog.filter((row) => row.fallback)
  console.log(`\nThreshold ${threshold}`)
  console.log(
    `In-catalog queries accepted and ranked first: ${confidentCorrect}/${inCatalog.length}. ` +
      `Accepted but wrong or lower: ${inCatalog.filter((row) => !row.fallback && row.hybridRank !== 1).length}. ` +
      `Fell through to AI: ${missedAccept.length}.`
  )
  console.log(
    `Lexical+uncovered correctly sent to fallback: ${negatives.length - falseAccept.length}/${negatives.length}. ` +
      `False accepts: ${falseAccept.length}.`
  )

  console.log("\nThreshold sweep (single English words always fall back; else accept if top score >= t)")
  console.log("t      inCatalog@1  fallthrough  falseAccept  lexical  uncovered")
  const sweep = []
  const accepts = (row: Scored, cutoff: number) => !isSingleLatinWord(row.query.query) && row.topScore >= cutoff
  for (let t = 30; t <= 80; t += 2) {
    const cutoff = t / 100
    const catalog = rows.filter((row) => !row.query.wantFallback)
    const at1 = catalog.filter((row) => accepts(row, cutoff) && row.hybridRank === 1).length
    const fall = catalog.filter((row) => !accepts(row, cutoff)).length
    const negatives = rows.filter((row) => row.query.wantFallback)
    const falseRows = negatives.filter((row) => accepts(row, cutoff))
    const falseLex = falseRows.filter((row) => row.query.kind === "lexical").length
    const falseUnc = falseRows.filter((row) => row.query.kind === "uncovered").length
    sweep.push({
      t: cutoff,
      at1,
      fall,
      falseA: falseRows.length,
      falseLex,
      falseUnc,
      catalog: catalog.length,
      negatives: negatives.length
    })
    if (t % 4 === 0) {
      console.log(
        `${cutoff.toFixed(2)}   ${String(at1).padStart(3)}/${catalog.length}       ${String(fall).padStart(3)}          ${
          String(falseRows.length).padStart(3)
        }/${negatives.length}     ${String(falseLex).padStart(3)}      ${String(falseUnc).padStart(3)}`
      )
    }
  }

  console.log("\nFalse accepts at the gate:")
  for (const row of decided.filter((item) => item.query.wantFallback && !item.fallback)) {
    console.log(`  ${row.topScore.toFixed(3)} ${row.topId} [${row.query.kind}] ${JSON.stringify(row.query.query)} kw ${row.keywordRank ?? "-"}`)
  }
  console.log("In-catalog sent to the model:")
  for (const row of decided.filter((item) => !item.query.wantFallback && item.fallback)) {
    console.log(
      `  ${row.topScore.toFixed(3)} ${row.topId} [${row.query.kind}] ${JSON.stringify(row.query.query)} ` +
        `expected ${row.query.situation} hybrid ${row.hybridRank ?? "-"} kw ${row.keywordRank ?? "-"}`
    )
  }
  console.log("In-catalog accepted but not rank 1:")
  for (const row of decided.filter((item) => !item.query.wantFallback && !item.fallback && item.hybridRank !== 1)) {
    console.log(
      `  ${row.topScore.toFixed(3)} ${row.topId} [${row.query.kind}] ${JSON.stringify(row.query.query)} ` +
        `expected ${row.query.situation} hybrid ${row.hybridRank ?? "-"}`
    )
  }

  const exact = rows.filter((row) => row.exactAlias).length
  console.log(`\nQueries whose text equals a title or alias: ${exact}/${rows.length}.`)

  const examples = [
    "how do I introduce myself",
    "what's a polite way to tell someone my name the first time we meet",
    "how do i introduse myself",
    "eat",
    "自己紹介",
    "how do I break up with someone",
    "where is the station",
    "how do I ask the price of a haircut",
    "I'm lost"
  ]
  console.log("\nExamples")
  for (const text of examples) {
    const row = rows.find((item) => item.query.query === text)
    if (row === undefined) continue
    const top = row.hybridIds.slice(0, 3).map((id, index) => {
      const hit = hybridTimed[queries.indexOf(row.query)]!.value[index]
      return `${id} (${hit?.score.toFixed(3)}, cos ${hit?.cosine?.toFixed(3) ?? "-"}, kw ${hit?.keywordRank ?? "-"})`
    })
    console.log(
      `\n"${text}" [${row.query.kind}] expected ${row.query.situation ?? "none"} fallback ${
        shouldFallback(text, row.topScore)
      }`
    )
    console.log(`  situations: ${top.join("; ") || "(none)"}`)
    console.log(`  dictionary: ${row.dictionaryHeadwords.join(", ") || "(none)"}`)
  }

  const intentRows = rows.filter((row) => row.query.situation !== null && row.query.kind !== "verbatim")
  const cosines = (kind: QueryKind) =>
    rows.filter((row) => row.query.kind === kind).map((row) => row.topCosine ?? 0).sort((a, b) => a - b)
  const median = (values: readonly number[]) => values.length === 0 ? null : values[Math.floor(values.length / 2)]!
  console.log("\nTop-hit cosine / fused score median by kind:")
  const scores = (kind: QueryKind) =>
    rows.filter((row) => row.query.kind === kind).map((row) => row.topScore).sort((a, b) => a - b)
  for (const kind of KINDS) {
    console.log(`  ${kind.padEnd(12)} cos ${fmt(median(cosines(kind)), 3)}  score ${fmt(median(scores(kind)), 3)}`)
  }
  void SCORE_THRESHOLD
  void intentRows

  mkdirSync("data", { recursive: true })
  const report = {
    indexed,
    backend: yield* repo.vectorBackend,
    warmupMs: warmMs,
    threshold,
    queries: rows.map((row) => ({
      query: row.query.query,
      kind: row.query.kind,
      expected: row.query.situation,
      wantFallback: row.query.wantFallback,
      exactAlias: row.exactAlias,
      dictionaryRank: row.dictionaryRank,
      keywordRank: row.keywordRank,
      vectorRank: row.vectorRank,
      hybridRank: row.hybridRank,
      topScore: row.topScore,
      topId: row.topId,
      topCosine: row.topCosine,
      dictionary: row.dictionaryHeadwords
    })),
    sweep
  }
  writeFileSync("data/situation-eval.json", JSON.stringify(report, null, 2))
  console.log("\nWrote data/situation-eval.json")
}).pipe(Effect.provide(EvalLive))

NodeRuntime.runMain(program)
