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
import { cautions, labels, loanLinks, usagePatterns } from "@kotori/db"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Command } from "effect/cli"
import { enrichCommand } from "../../src/cli/enrich.ts"
import { Database } from "../../src/db/Database.ts"
import { AudioStore } from "../../src/features/audio/AudioStore.ts"
import { Speech } from "../../src/features/audio/Speech.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import { insertEntries, linkLoans } from "../../src/features/dictionary/queries.ts"
import { AudioEnricher } from "../../src/features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../../src/features/enrichment/Enrichers.ts"
import { examplesFor, saveExamples } from "../../src/features/enrichment/queries.ts"
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
  id: number,
  headword: string,
  reading: string,
  glosses: Array<string>,
  options: { readonly source?: "jmdict" | "kotori"; readonly misc?: Array<string>; readonly info?: Array<string> } = {}
): EntryRecord => ({
  id: EntryId.make(id),
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

layer(TestLayer)("CLI kotori enrich", (it) => {
  const runCli = (args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const enrichers = yield* Enrichers
      const cmd = enrichCommand(Layer.succeed(Enrichers, enrichers))
      yield* Command.runWith(cmd, { version: "0.1.0" })(args)
    })

  it.effect("runs enrichment manually on targeted entries only", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const taberu = EntryId.make(1358280)
      const nomu = EntryId.make(1169870)
      yield* insertEntries(db, [
        jaEntry(taberu, "食べる", "たべる", ["to eat"]),
        jaEntry(nomu, "飲む", "のむ", ["to drink"])
      ])

      writtenFor.length = 0
      synthesized.length = 0
      yield* runCli(["run", "examples", "--entry", String(taberu)])
      yield* runCli(["run", "audio", "--entry", String(taberu)])

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

  it.effect("wipes all AI enrichment instantaneously without touching Source facts or spoken Form audio", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const taberu = EntryId.make(1358280)
      const mansion = EntryId.make(1079450)
      const approved = EntryId.make(200000001)

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

      // Add AI enrichment on top of Source facts: Kotori examples, cautions, labels, usage patterns, loan verdict, and spoken Form audio.
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
      yield* db.insert(cautions).values([
        { entryId: taberu, sense: null, rank: 1, kind: "tone", text: "AI caution on JMDict word", source: "kotori" },
        { entryId: approved, sense: null, rank: 1, kind: "tone", text: "Approved entry caution", source: "kotori" }
      ])
      yield* db.insert(labels).values({ entryId: taberu, sense: 0, code: "form", source: "kotori" })
      yield* db.insert(usagePatterns).values({
        entryId: taberu,
        sense: 0,
        position: 1,
        text: "AI usage pattern",
        source: "kotori"
      })
      yield* db.update(loanLinks).set({ meaning: "wasei_eigo", meaningSource: "kotori" })
      yield* db.insert(loanLinks).values({
        katakana: "テスト",
        katakanaEntryId: null,
        english: "test",
        englishEntryId: null,
        meaning: "true_loanword",
        source: "kotori",
        meaningSource: "kotori"
      })
      yield* runCli(["run", "audio", "--entry", String(taberu)])
      const audioBefore = Option.getOrThrow(yield* dictionary.entry(taberu)).audioUrl
      assert.isNotNull(audioBefore)

      // Wipe all AI enrichment via CLI.
      yield* runCli(["wipe"])

      const afterTaberu = Option.getOrThrow(yield* dictionary.entry(taberu))
      const afterMansion = Option.getOrThrow(yield* dictionary.entry(mansion))
      const afterApproved = Option.getOrThrow(yield* dictionary.entry(approved))

      // AI enrichment on JMDict entries is gone.
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
        (yield* examplesFor(db, [taberu])).map((e) => [e.ja, e.source]),
        [["パンを食べる。", "tatoeba"]]
      )
      // JMDict loan link stays, but Kotori's verdict is cleared; Kotori-only loan link is deleted.
      assert.strictEqual(afterMansion.loanLink?.source, "jmdict")
      assert.isNull(afterMansion.loanLink?.meaning)
      assert.isNull(afterMansion.loanLink?.meaningSource)
      assert.strictEqual(yield* db.$count(loanLinks), 1)

      // Spoken Form pronunciation audio is completely untouched!
      assert.strictEqual(afterTaberu.audioUrl, audioBefore)
      assert.isAbove(afterTaberu.audio.length, 0)

      // Kotori-sourced approved entry keeps its own labels and cautions.
      assert.deepStrictEqual(
        afterApproved.labels.map((l) => l.code),
        ["sl"]
      )
      assert.strictEqual(afterApproved.cautions.length, 1)
    })
  )
})
