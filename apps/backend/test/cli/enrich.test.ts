import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import {
  Claude,
  ClaudeError,
  ElevenLabs,
  ENGLISH_CAST,
  ExampleWriter,
  JAPANESE_CAST,
  Jev,
  Pronouncer,
  VoiceCasts
} from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Command } from "effect/cli"
import { enrichCommand } from "../../src/cli/enrich.ts"
import { searchCommand } from "../../src/cli/search.ts"
import { Database } from "../../src/db/Database.ts"
import { discardEntry, mergeEntry } from "../../src/features/asks/review.ts"
import { AudioStore } from "../../src/features/audio/AudioStore.ts"
import { Speech } from "../../src/features/audio/Speech.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import { insertEntries, linkLoans, saveKotoriCautions } from "../../src/features/dictionary/queries.ts"
import { rebuildEntrySearch } from "../../src/features/dictionary/searchProjection.ts"
import { AudioEnricher } from "../../src/features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../../src/features/enrichment/Enrichers.ts"
import { saveExamples } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

const synthesized: Array<string> = []
const writtenFor: Array<string> = []

const FakeProviders = Layer.mergeAll(
  Layer.succeed(
    Claude,
    Claude.of({
      model: "test-claude",
      available: Effect.succeed(true),
      generate: () => Effect.fail(new ClaudeError({ reason: "unconfigured", message: "unused" }))
    })
  ),
  Layer.succeed(
    ExampleWriter,
    ExampleWriter.of({
      model: "test-claude",
      write: (input) =>
        Effect.sync(() => {
          writtenFor.push(input.headword)
          return {
            examples: [
              {
                sense: 0,
                ja: `${input.headword}の例文。`,
                furigana: `${input.headword}の例文。`,
                en: `Example for ${input.headword}.`,
                formality: "polite" as const,
                note: null,
                noteJa: null,
                casting: {
                  speakerGender: "unspecified" as const,
                  speakerAge: "unspecified" as const,
                  medium: null,
                  variety: null,
                  tone: null
                }
              }
            ],
            dropped: 0
          }
        })
    })
  ),
  Layer.succeed(
    ElevenLabs,
    ElevenLabs.of({
      configured: true,
      model: "test-tts",
      synthesize: (text) =>
        Effect.sync(() => {
          synthesized.push(text)
          return new TextEncoder().encode(`mp3:${text}`)
        })
    })
  ),
  Layer.succeed(Jev, Jev.of({ configured: false, model: "test-jev", ask: () => Effect.die("unused") })),
  Layer.succeed(VoiceCasts, {
    ja: JAPANESE_CAST.map((voice) => ({ ...voice, providerId: `fake-${voice.id}` })),
    en: ENGLISH_CAST.map((voice) => ({ ...voice, providerId: `fake-${voice.id}` }))
  })
)

const EnrichServices = Enrichers.layer.pipe(
  Layer.provideMerge(AudioEnricher.layer),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(AudioStore.database),
  Layer.provideMerge(Pronouncer.layer),
  Layer.provideMerge(FakeProviders),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ KOTORI_HEADWORD_VOICES: "1" })))
)

const TestLayer = Layer.mergeAll(Dictionary.layer, EnrichServices, NodeServices.layer).pipe(
  Layer.provideMerge(DatabaseMemory)
)

const sense = (glosses: Array<string>, pos: Array<string>, misc: Array<string> = [], info: Array<string> = []) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos,
  misc,
  fields: [],
  dialects: [],
  info,
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  origins: [],
  wasei: false
})

const jaEntry = (
  id: EntryId,
  headword: string,
  reading: string,
  glosses: Array<string>,
  options: { readonly source?: "jmdict" | "kotori"; readonly misc?: Array<string>; readonly info?: Array<string> } = {}
): EntryRecord => ({
  id,
  language: "ja",
  source: options.source ?? "jmdict",
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [sense(glosses, ["v1"], options.misc, options.info)]
})

layer(TestLayer)("CLI kotori enrich & kotori search", (it) => {
  const runEnrich = (args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const enrichers = yield* Enrichers
      const cmd = enrichCommand(Layer.succeed(Enrichers, enrichers))
      yield* Command.runWith(cmd, { version: "0.1.0" })(args)
    })

  const runSearchCli = (args: ReadonlyArray<string>) => Command.runWith(searchCommand, { version: "0.1.0" })(args)

  it.effect("runs enrichment manually on targeted deterministic string entry IDs only", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const taberu = EntryId.make("jmdict:1358280")
      const nomu = EntryId.make("jmdict:1169870")
      yield* insertEntries(db, [
        jaEntry(taberu, "食べる", "たべる", ["to eat"]),
        jaEntry(nomu, "飲む", "のむ", ["to drink"])
      ])

      writtenFor.length = 0
      synthesized.length = 0
      yield* runEnrich(["run", "examples", "--entry", taberu])
      yield* runEnrich(["run", "audio", "--entry", taberu])

      assert.deepStrictEqual(writtenFor, ["食べる"])
      assert.deepStrictEqual(synthesized, ["たべる"])

      const enriched = Option.getOrThrow(yield* dictionary.entry(taberu))
      const untouched = Option.getOrThrow(yield* dictionary.entry(nomu))
      assert.strictEqual(enriched.senses[0]?.examples.length, 1)
      assert.isNotNull(enriched.audioUrl)
      assert.strictEqual(untouched.senses[0]?.examples.length, 0)
      assert.isNull(untouched.audioUrl)
    })
  )

  it.effect("wipes entries.enrichment to null without touching base, entry_search, or spoken Form audio", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const taberu = EntryId.make("jmdict:1358280")
      const mansion = EntryId.make("jmdict:1079450")
      const approved = EntryId.make("kotori:kaeruka")

      yield* insertEntries(
        db,
        [
          {
            ...jaEntry(taberu, "食べる", "たべる", ["to eat"], {
              misc: ["col"],
              info: ["Source usage note"]
            }),
            senses: [
              {
                ...sense(["to eat"], ["v1"], ["col"], ["Source usage note"]),
                examples: [{ ja: "パンを食べる。", en: "I eat bread.", source: "tatoeba" as const }]
              }
            ]
          },
          {
            ...jaEntry(mansion, "マンション", "マンション", ["condominium"]),
            senses: [{ ...sense(["condominium"], ["n"]), origins: [{ language: "eng", word: "mansion" }] }]
          },
          jaEntry(approved, "蛙化現象", "かえるかげんしょう", ["the ick"], { source: "kotori", misc: ["sl"] })
        ],
        { seeded: true }
      )
      yield* linkLoans(db)

      // Add AI enrichment on top of Source facts.
      yield* saveExamples(
        db,
        taberu,
        [
          {
            sense: 0,
            ja: "朝ご飯を食べる。",
            furigana: "朝ご飯を食べる。",
            en: "I eat breakfast.",
            formality: "casual",
            note: null,
            model: "test-claude"
          }
        ],
        new Date(1000)
      )
      yield* saveKotoriCautions(db, taberu, "ja", [
        { sense: null, kind: "tone", text: "AI caution on JMDict word", about: null }
      ])
      yield* saveKotoriCautions(db, approved, "ja", [
        { sense: null, kind: "tone", text: "Approved entry caution", about: null }
      ])
      yield* runEnrich(["run", "audio", "--entry", taberu])
      const audioBefore = Option.getOrThrow(yield* dictionary.entry(taberu)).audioUrl
      assert.isNotNull(audioBefore)

      // Wipe all AI enrichment via CLI.
      yield* runEnrich(["wipe"])

      const afterTaberu = Option.getOrThrow(yield* dictionary.entry(taberu))
      const afterMansion = Option.getOrThrow(yield* dictionary.entry(mansion))
      const afterApproved = Option.getOrThrow(yield* dictionary.entry(approved))

      // AI enrichment on JMDict entries is gone; Source facts remain intact.
      assert.deepStrictEqual(afterTaberu.cautions, [])
      assert.deepStrictEqual(
        afterTaberu.labels.map((l) => [l.code, l.source]),
        [["col", "jmdict"]]
      )
      assert.deepStrictEqual(
        afterTaberu.senses[0]?.usagePatterns.map((u) => [u.text, u.source]),
        [["Source usage note", "jmdict"]]
      )
      assert.deepStrictEqual(
        afterTaberu.senses[0]?.examples.map((e) => [e.ja, e.source]),
        [["パンを食べる。", "tatoeba"]]
      )
      assert.strictEqual(afterMansion.loanLink?.source, "jmdict")
      assert.isNull(afterMansion.loanLink?.meaning)

      // Spoken Form pronunciation audio and search results are completely untouched.
      assert.strictEqual(afterTaberu.audioUrl, audioBefore)
      assert.isAbove(afterTaberu.audio.length, 0)
      assert.strictEqual((yield* dictionary.search("食べる", "ja", 5)).entries[0]?.id, taberu)

      // Kotori-sourced approved entry keeps its own base labels and cautions.
      assert.deepStrictEqual(
        afterApproved.labels.map((l) => l.code),
        ["sl"]
      )
      assert.strictEqual(afterApproved.cautions.length, 1)
    })
  )

  it.effect("bounded CLI enrichment skips discarded and merged entries", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const active = EntryId.make("jmdict:1580640")
      const discarded = EntryId.make("kotori:discarded-enrich")
      const merged = EntryId.make("kotori:merged-enrich")

      yield* insertEntries(db, [{ ...jaEntry(active, "走る", "はしる", ["to run"]), priority: 900 }])
      yield* insertEntries(
        db,
        [
          { ...jaEntry(discarded, "ボツ語", "ぼつご", ["junk"], { source: "kotori" }), priority: 999 },
          { ...jaEntry(merged, "重複語", "ちょうふくご", ["dup"], { source: "kotori" }), priority: 998 }
        ],
        { reviewState: "unreviewed" }
      )
      yield* discardEntry(db, discarded, "not a word")
      yield* mergeEntry(db, merged, active)

      writtenFor.length = 0
      yield* runEnrich(["run", "examples", "--dictionary", "jmdict", "--limit", "1"])

      assert.deepStrictEqual(writtenFor, ["走る"])
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(active)).senses[0]?.examples.length, 1)
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(discarded)).senses[0]?.examples.length, 0)
    })
  )

  it.effect("kotori search rebuild rebuilds entry_search from entries.base without touching enrichment", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const oyogu = EntryId.make("jmdict:1580650")

      yield* insertEntries(db, [jaEntry(oyogu, "泳ぐ", "およぐ", ["to swim"])])
      yield* saveExamples(
        db,
        oyogu,
        [
          {
            sense: 0,
            ja: "プールで泳ぐ。",
            furigana: "プールで泳ぐ。",
            en: "I swim in the pool.",
            formality: "polite",
            note: null,
            model: "test-claude"
          }
        ],
        new Date(2000)
      )

      const summary = yield* rebuildEntrySearch(db)
      assert.isAtLeast(summary.entries, 1)
      assert.isAtLeast(summary.indexedRows, 1)

      yield* runSearchCli(["rebuild"])

      assert.strictEqual((yield* dictionary.search("泳ぐ", "ja", 5)).entries[0]?.id, oyogu)
      // Enrichment on entries was untouched by rebuilding entry_search.
      const after = Option.getOrThrow(yield* dictionary.entry(oyogu))
      assert.strictEqual(after.senses[0]?.examples.length, 1)
      assert.strictEqual(after.senses[0]?.examples[0]?.ja, "プールで泳ぐ。")
    })
  )
})
