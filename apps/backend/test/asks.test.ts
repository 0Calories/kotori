import { assert, layer } from "@effect/vitest"
import {
  Claude,
  ClaudeError,
  type DraftOutput,
  ElevenLabs,
  Jev,
  JevError,
  Lexicographer,
  Pronouncer,
  TtsError
} from "@kotori/ai"
import type { Profile } from "@kotori/contracts"
import { Effect, Layer } from "effect"
import { Database } from "../src/db/Database.ts"
import { Asks, askable, normalizeAsk } from "../src/features/asks/Asks.ts"
import { Dictionary } from "../src/features/dictionary/Dictionary.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { ensureUser } from "../src/features/accounts/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"
import { english, learner, U1 } from "./fixtures.ts"

// The Asks service over PGlite and a Claude whose answers are queued by the test.

process.env["KOTORI_ASK_HOURLY_LIMIT"] = "4"

const queued: Array<DraftOutput> = []
let generated = 0

const FakeClaude = Layer.succeed(
  Claude,
  Claude.of({
    model: "test-model",
    available: Effect.succeed(true),
    generate: () =>
      Effect.suspend(() => {
        generated++
        const next = queued.shift()
        return next === undefined
          ? Effect.fail(new ClaudeError({ reason: "unavailable", message: "no answer queued" }))
          : Effect.succeed(next as never)
      })
  })
)

const FakeProviders = Layer.mergeAll(
  FakeClaude,
  Layer.succeed(
    Jev,
    Jev.of({ configured: false, model: "test", ask: () => Effect.fail(new JevError({ message: "unused" })) })
  ),
  Layer.succeed(
    ElevenLabs,
    ElevenLabs.of({
      configured: false,
      model: "test",
      synthesize: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "unused" }))
    })
  )
)

const TestLayer = Asks.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Dictionary.layer, Lexicographer.layer)),
  Layer.provideMerge(Pronouncer.layer),
  Layer.provideMerge(FakeProviders),
  Layer.provideMerge(DatabaseMemory)
)

const asker: Profile = {
  ...learner,
  nativeLanguage: "ja",
  targetLanguage: "en",
  email: "a@kotori.test",
  emailVerified: true,
  onboarded: true
}

/** Idempotent: every test seeds, so each runs alone (`vitest -t`) and none leans on another. */
const seeded = Effect.gen(function* () {
  const db = yield* Database
  yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
  yield* insertEntries(db, english)
})

const draft = (headword: string, spellings: ReadonlyArray<string> = []): DraftOutput => ({
  verdict: "entry",
  link: null,
  reason: null,
  entry: {
    headword,
    reading: "",
    spellings,
    currency: "trendy",
    senses: [{ glosses: ["すごくおいしい"], partOfSpeech: "adj", labels: ["sl"], note: "若者のスラングです。" }]
  }
})

layer(TestLayer)("Asks", (it) => {
  it.effect("gates queries and refuses what the dictionary already answers", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks

      // Too short, markup, too many words, the wrong script.
      for (const bad of ["a", "<script>", "one two three four five six seven eight nine", "食べる"]) {
        const result = yield* Effect.flip(asks.ask(asker, bad))
        assert.strictEqual(result._tag, "InvalidRequest")
      }
      assert.isTrue(askable("bussin", "en"))
      assert.isTrue(askable("それな", "ja"))
      assert.isTrue(askable("sorena", "ja"))
      assert.strictEqual(normalizeAsk("  Bussin ", "en"), "bussin")

      // "eat" is in the fixtures: a strong match, nothing to ask.
      const eat = yield* Effect.flip(asks.ask(asker, "eat"))
      assert.strictEqual(eat._tag, "InvalidRequest")
      assert.strictEqual(generated, 0)
    })
  )

  it.effect("drafts an entry once and serves every later ask from the answer", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      queued.push(draft("bussin"))

      const first = yield* asks.ask(asker, "Bussin")
      assert.strictEqual(first.status, "pending")
      assert.strictEqual(first.query, "bussin")
      assert.strictEqual(first.draft?.headword, "bussin")
      assert.strictEqual(first.draft?.senses[0]?.glosses[0], "すごくおいしい")
      assert.strictEqual(generated, 1)

      const again = yield* asks.ask(asker, "bussin")
      assert.strictEqual(again.id, first.id)
      assert.strictEqual(generated, 1)

      const mine = yield* asks.asks(asker)
      assert.deepStrictEqual(
        mine.map((proposal) => proposal.query),
        ["bussin"]
      )
    })
  )

  it.effect("links a variant to the entry Claude names instead of keeping a draft", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      // The fixtures hold "eat"; Claude recognises the query as it.
      queued.push({ verdict: "link", link: "eat", reason: null, entry: null })
      const linked = yield* asks.ask(asker, "eeting good")
      assert.strictEqual(linked.status, "linked")
      assert.strictEqual(linked.draft, null)
      assert.strictEqual(linked.linked?.headword, "eat")
    })
  )

  it.effect("turns a draft whose headword already exists into a link, never a duplicate", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      queued.push(draft("new word", ["dine"]))
      const linked = yield* asks.ask(asker, "dine fancy")
      assert.strictEqual(linked.status, "linked")
      assert.strictEqual(linked.linked?.headword, "dine")
    })
  )

  it.effect("keeps a rejected query as the answer, and rate-limits fresh asks per learner", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      queued.push({ verdict: "reject", link: null, reason: "実在する表現ではないようです。", entry: null })
      const rejected = yield* asks.ask(asker, "blorptastic")
      assert.strictEqual(rejected.status, "rejected")
      assert.strictEqual(rejected.reason, "実在する表現ではないようです。")

      // Four fresh asks so far (bussin, eeting good, dine fancy, blorptastic) used up the limit
      // of 4 — the reservation is taken before each generation — so the next fresh ask is refused …
      queued.push(draft("yeet"))
      const limited = yield* Effect.flip(asks.ask(asker, "yeet"))
      assert.strictEqual(limited._tag, "RateLimited")
      // … while cached answers stay free.
      const cached = yield* asks.ask(asker, "bussin")
      assert.strictEqual(cached.status, "pending")
    })
  )
})
