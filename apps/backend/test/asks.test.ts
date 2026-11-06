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
import type { Language, Profile } from "@kotori/contracts"
import { EntryId, UserId } from "@kotori/contracts"
import { proposals } from "@kotori/db"
import { normalizeAsk } from "@kotori/language"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "../src/db/Database.ts"
import { Asks } from "../src/features/asks/Asks.ts"
import { askable } from "../src/features/asks/garbage.ts"
import { redoProposal } from "../src/features/asks/review.ts"
import { Dictionary } from "../src/features/dictionary/Dictionary.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { ensureUser } from "../src/features/accounts/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"
import { english, kana, kanji, learner, sense } from "./fixtures.ts"

// The Asks service over PGlite and a Claude whose answers are queued by the test.

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
  Layer.provideMerge(DatabaseMemory),
  // Not process.env: Effect reads it once per process, and test files share workers
  // (`isolate: false`), so a file that read config first would fix the limits for this one.
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        KOTORI_ASK_HOURLY_LIMIT: "4",
        KOTORI_ASK_DAILY_LIMIT: "6",
        KOTORI_TRIAGE_HOURLY_LIMIT: "100"
      })
    )
  )
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
const linker = learnerNo(7)
const drafter = learnerNo(8)
const yomi = learnerNo(9, "ja")

/** 上手 is two words: じょうず (skilled) and うわて (superior). Neither is read かみて here. */
const jouzu = {
  id: EntryId.make(1900001),
  language: "ja" as const,
  dictionary: "jmdict" as const,
  headword: "上手",
  reading: "じょうず",
  common: true,
  priority: 100,
  forms: [kanji("上手"), kana("じょうず")],
  senses: [sense(["skillful", "good at"], { pos: ["adj-na"] })]
}
const uwate = {
  ...jouzu,
  id: EntryId.make(1900002),
  reading: "うわて",
  common: false,
  priority: 40,
  forms: [kanji("上手"), kana("うわて")],
  senses: [sense(["superior", "better"], { pos: ["n"] })]
}

/** Idempotent: every test seeds, so each runs alone (`vitest -t`) and none leans on another. */
const seeded = Effect.gen(function* () {
  // Answers a refused ask never consumed would otherwise answer the next test's questions.
  queued.length = 0
  routes.length = 0
  const db = yield* Database
  for (const user of [asker, other, daily, routed, strict, japanese, linker, drafter, yomi]) {
    yield* ensureUser(db, { id: user.id, displayName: null, createdAt: new Date(0) })
  }
  yield* insertEntries(db, [...english, jouzu, uwate])
})

/** The number `headword` is shown to Claude under, among the lookalikes the search for `query` finds. */
const numberOf = (query: string, language: Language, headword: string) =>
  Effect.gen(function* () {
    const found = yield* (yield* Dictionary).search(normalizeAsk(query, language), language, 10)
    const index = found.entries.findIndex((entry) => entry.headword === headword)
    assert.isAtLeast(index, 0, `${headword} is among the lookalikes for ${query}`)
    return index + 1
  })

const draft = (
  headword: string,
  spellings: ReadonlyArray<string> = [],
  fields: Partial<NonNullable<DraftOutput["entry"]>> = {}
): DraftOutput => ({
  verdict: "entry",
  link: null,
  reason: null,
  entry: {
    headword,
    reading: "",
    spellings,
    familiarity: 4,
    senses: [{ glosses: ["すごくおいしい"], pos: ["adj"], labels: ["sl"], patterns: ["若者のスラングです。"] }],
    pitfalls: [],
    ...fields
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

  it.effect("links a variant to the lookalike Claude numbers instead of keeping a draft", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      // "polsh" finds "polish" and "Polish", which match each other case-folded: the number says which.
      queued.push({ verdict: "link", link: yield* numberOf("polsh", "en", "Polish"), reason: null, entry: null })
      const linked = yield* asks.ask(asker, "polsh")
      assert.strictEqual(linked.status, "linked")
      assert.strictEqual(linked.draft, null)
      assert.strictEqual(linked.linked?.id, EntryId.make(100000002))
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

  it.effect("links only a lookalike Claude was shown, whatever else the dictionary holds", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      // The search finds nothing for this, so a link could only come from Claude's memory.
      queued.push({ verdict: "link", link: 1, reason: null, entry: null })
      const unseen = yield* asks.ask(linker, "eeting good")
      assert.strictEqual(unseen.status, "rejected")
      assert.strictEqual(unseen.linked, null)
      // A number past the list is no link either.
      queued.push({ verdict: "link", link: 9, reason: null, entry: null })
      const past = yield* asks.ask(linker, "polishy")
      assert.strictEqual(past.status, "rejected")
      // Nor is one that came with a draft: the draft stands instead.
      queued.push({ ...draft("polished off"), verdict: "link", link: 0 })
      const drafted = yield* asks.ask(linker, "polished off")
      assert.strictEqual(drafted.status, "pending")
      assert.strictEqual(drafted.draft?.headword, "polished off")
    })
  )

  it.effect("takes a draft for an existing entry only when it can tell which entry", () =>
    Effect.gen(function* () {
      yield* seeded
      const asks = yield* Asks
      // English matches case-folded, so an exact spelling decides between "polish" and "Polish"…
      queued.push(draft("polish"))
      const exact = yield* asks.ask(drafter, "polish up nicely")
      assert.strictEqual(exact.status, "linked")
      assert.strictEqual(exact.linked?.id, EntryId.make(100000003))
      // …and without one, neither is chosen, and the draft waits for the admin.
      queued.push(draft("POLISH"))
      const unsure = yield* asks.ask(drafter, "polishing up")
      assert.strictEqual(unsure.status, "pending")
      assert.strictEqual(unsure.linked, null)

      // Japanese homographs are told apart by reading, katakana or hiragana.
      queued.push(draft("上手", [], { reading: "ウワテ" }))
      const uwateDraft = yield* asks.ask(yomi, "うわてっぽい")
      assert.strictEqual(uwateDraft.status, "linked")
      assert.strictEqual(uwateDraft.linked?.id, uwate.id)
      queued.push(draft("上手", [], { reading: "じょうず" }))
      const jouzuDraft = yield* asks.ask(yomi, "じょうずめ")
      assert.strictEqual(jouzuDraft.linked?.id, jouzu.id)
      // A reading neither has is another word written the same: a draft, not a link.
      queued.push(draft("上手", [], { reading: "かみて" }))
      const kamite = yield* asks.ask(yomi, "かみてがわ")
      assert.strictEqual(kamite.status, "pending")
      assert.strictEqual(kamite.draft?.reading, "かみて")
    })
  )
})
