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
import { UserId } from "@kotori/contracts"
import { proposals } from "@kotori/db"
import { normalizeAsk } from "@kotori/language"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "../src/db/Database.ts"
import { Asks } from "../src/features/asks/Asks.ts"
import { askable } from "../src/features/asks/garbage.ts"
import { redoProposal } from "../src/features/asks/review.ts"
import { Dictionary } from "../src/features/dictionary/Dictionary.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { ensureUser } from "../src/features/accounts/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"
import { english, learner } from "./fixtures.ts"

// The Asks service over PGlite and a Claude whose answers are queued by the test.

process.env["KOTORI_ASK_HOURLY_LIMIT"] = "4"
process.env["KOTORI_ASK_DAILY_LIMIT"] = "6"
process.env["KOTORI_TRIAGE_HOURLY_LIMIT"] = "100"

const queued: Array<DraftOutput> = []
let generated = 0

/** Jev's next routing answers; empty means a sure lookup. A thrown entry fails the request. */
const routes: Array<Record<string, number> | "fail"> = []
let triaged = 0

const choice = (probabilities: Record<string, number>) => {
  const best = Object.entries(probabilities).toSorted(([, a], [, b]) => b - a)[0]!
  return { type: "choice", choice: best[0], confidence: best[1], probabilities }
}

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: () =>
      Effect.suspend(() => {
        triaged++
        const next = routes.shift() ?? { lookup: 0.9, garbage: 0.1 }
        if (next === "fail") return Effect.fail(new JevError({ message: "jev down" }))
        return Effect.succeed({
          answers: { route: choice(next), "route~reversed": choice(next) },
          usage: { input_tokens: 1 }
        } as never)
      })
  })
)

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
  FakeJev,
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

/** More learners, each with allowances of their own, for the tests after a rate limit is reached. */
const learnerNo = (n: number, target: Profile["targetLanguage"] = "en"): Profile => ({
  ...asker,
  id: UserId.make(`00000000-0000-4000-8000-00000000000${n}`),
  email: `${n}@kotori.test`,
  nativeLanguage: target === "en" ? "ja" : "en",
  targetLanguage: target
})
const other = learnerNo(2)
const daily = learnerNo(3)
const routed = learnerNo(4)
const strict = learnerNo(5)
const japanese = learnerNo(6, "ja")

/** Idempotent: every test seeds, so each runs alone (`vitest -t`) and none leans on another. */
const seeded = Effect.gen(function* () {
  // Answers a refused ask never consumed would otherwise answer the next test's questions.
  queued.length = 0
  routes.length = 0
  const db = yield* Database
  for (const user of [asker, other, daily, routed, strict, japanese]) {
    yield* ensureUser(db, { id: user.id, displayName: null, createdAt: new Date(0) })
  }
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

      // Too short, markup, too many words: codes the app words, never copy.
      for (const bad of ["a", "a<b>c", "one two three four five six seven eight nine"]) {
        assert.deepInclude(yield* Effect.flip(asks.ask(asker, bad)), { _tag: "AskRefused", reason: "not_askable" })
      }
      // The learner's own language, Japanese for a Japanese speaker learning English.
      assert.deepInclude(yield* Effect.flip(asks.ask(asker, "食べる")), {
        _tag: "AskRefused",
        reason: "wrong_language"
      })
      assert.isTrue(askable("bussin", "en"))
      assert.isTrue(askable("それな", "ja"))
      assert.isTrue(askable("sorena", "ja"))
      assert.strictEqual(normalizeAsk("  Bussin ", "en"), "bussin")

      // "eat" is in the fixtures: a strong match, nothing to ask.
      assert.deepInclude(yield* Effect.flip(asks.ask(asker, "eat")), { _tag: "AskRefused", reason: "in_dictionary" })
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

  it.effect("turns mash away for free, before anyone is asked", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      const before = { generated, triaged }
      assert.deepInclude(yield* Effect.flip(asks.ask(asker, "asdfgh")), { _tag: "AskRefused", reason: "keyboard" })
      assert.deepInclude(yield* Effect.flip(asks.ask(asker, "aaaaaaa")), { _tag: "AskRefused", reason: "repetition" })
      assert.deepStrictEqual({ generated, triaged }, before)
    })
  )

  it.effect("lets real words, interjections and rōmaji the free checks once turned away reach Jev", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      const reaching = [
        ...[
          "catchphrase",
          "sightscreen",
          "watchstrap",
          "weltschmerz",
          "latchstring",
          "borschts",
          "hmmmm",
          "shhhh",
          "brrrr",
          "mmhmm",
          "tsktsk",
          "nooooo",
          "sooooo"
        ].map((query) => ({ user: strict, query })),
        { user: japanese, query: "matcha" }
      ]
      const before = { generated, triaged }
      for (const { user, query } of reaching) {
        // Jev answers each (here: as mash, so Claude isn't needed); what matters is that it was asked.
        routes.push({ lookup: 0.05, garbage: 0.95 })
        const answer = yield* asks.ask(user, query)
        assert.strictEqual(answer.route, "garbage", query)
      }
      assert.deepStrictEqual({ generated, triaged }, { generated: before.generated, triaged: before.triaged + 14 })
    })
  )

  it.effect("caps each learner's Claude asks per day as well as per hour, without holding anyone else back", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      const ask = (query: string) => {
        queued.length = 0
        queued.push(draft(query))
        return asks.ask(daily, query)
      }
      for (const query of ["snorkle", "wibbler", "plonker", "zazzle"]) yield* ask(query)
      assert.deepInclude(yield* Effect.flip(ask("gronkle")), { _tag: "RateLimited", retryAfterSeconds: 600 })
      // An hour on, the hourly allowance is back, but the day's runs out after six.
      yield* TestClock.adjust("61 minutes")
      for (const query of ["gronkle", "fizzle"]) yield* ask(query)
      assert.deepInclude(yield* Effect.flip(ask("blooper")), { _tag: "RateLimited", retryAfterSeconds: 3600 })
      // Another learner asks freely meanwhile.
      queued.length = 0
      queued.push(draft("blooper"))
      assert.strictEqual((yield* asks.ask(routed, "blooper")).status, "pending")
    })
  )

  it.effect("never counts Jev's routing toward Claude's allowance", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      // More Jev-routed asks than Claude's hourly allowance of 4 …
      for (const query of ["what is this", "how do i say it", "is this right", "say it nicely", "tell me more"]) {
        routes.push({ lookup: 0.05, sentence: 0.95 })
        assert.strictEqual((yield* asks.ask(routed, query)).route, "sentence")
      }
      // … and Claude can still be asked.
      queued.push(draft("snazzle"))
      assert.strictEqual((yield* asks.ask(routed, "snazzle")).status, "pending")
    })
  )

  it.effect("lets Jev route sentences, names and the wrong language away without Claude, remembering the route", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      const before = generated
      routes.push({ lookup: 0.1, sentence: 0.85, name: 0.05 })
      const sentence = yield* asks.ask(other, "how do i say thank you politely")
      assert.strictEqual(sentence.status, "rejected")
      assert.strictEqual(sentence.route, "sentence")
      assert.strictEqual(sentence.reason, null)
      assert.strictEqual(generated, before)
      // The route is the cached answer too.
      const again = yield* asks.ask(other, "how do i say thank you politely")
      assert.strictEqual(again.id, sentence.id)
    })
  )

  it.effect("falls open to Claude when Jev is unsure or down, and flags a contested rejection", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      // Unsure: no route reaches the bar, so Claude is asked.
      routes.push({ lookup: 0.3, name: 0.4, garbage: 0.3 })
      queued.push(draft("glorp"))
      const unsure = yield* asks.ask(other, "glorp")
      assert.strictEqual(unsure.status, "pending")
      assert.strictEqual(unsure.route, "lookup")
      // Down: likewise.
      routes.push("fail")
      queued.push(draft("zonked"))
      const down = yield* asks.ask(other, "zonked")
      assert.strictEqual(down.status, "pending")
      // Jev sure it was a lookup, Claude said no: contested, for the admin's eye.
      routes.push({ lookup: 0.95, garbage: 0.05 })
      queued.push({ verdict: "reject", link: null, reason: null, entry: null })
      const contested = yield* asks.ask(other, "frindle")
      assert.strictEqual(contested.status, "rejected")
      // No reason from Claude: the app words one, rather than the server.
      assert.strictEqual(contested.reason, null)
      const db = yield* Database
      const [row] = yield* db.select().from(proposals).where(eq(proposals.id, contested.id))
      assert.strictEqual(row?.contested, true)
      assert.strictEqual(row?.triage?.model, "jev-test")
    })
  )

  it.effect("redo asks Claude again about a rejection, even Jev's, and only a rejection", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      const db = yield* Database
      routes.push({ lookup: 0.05, name: 0.95 })
      const rejected = yield* asks.ask(other, "yoinks")
      assert.strictEqual(rejected.route, "name")
      queued.push(draft("yoinks"))
      const { proposal } = yield* redoProposal(db, rejected.id)
      assert.strictEqual(proposal.status, "pending")
      assert.strictEqual(proposal.draft?.headword, "yoinks")
      // Claude's answer stands, so the app shows it rather than Jev's pointer.
      assert.strictEqual(proposal.route, "lookup")
      assert.deepInclude(yield* Effect.flip(redoProposal(db, rejected.id)), { _tag: "NotRejected", status: "pending" })
      assert.strictEqual((yield* Effect.flip(redoProposal(db, 999_999)))._tag, "NoSuchProposal")
    })
  )
})
