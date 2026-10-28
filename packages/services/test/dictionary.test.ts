import { assert, describe, it, layer } from "@effect/vitest"
import { at, Database } from "@kotori/db"
import { examples, senseNuance } from "@kotori/db/schema"
import { EntryId } from "@kotori/domain"
import { Effect, FileSystem, Layer, Option } from "effect"
import { Dictionary, Enrichment } from "../src/index.ts"
import { entry, sense, servicesWith } from "./fixtures.ts"

const taberu = 1358280
const kuu = 1269130
const meshiagaru = 1594790
const taiyaki = 1000000

const words = [
  entry(taberu, "食べる", "たべる", [sense(["to eat"]), sense(["to live on (e.g. a salary)", "to subsist on"])], {
    priority: 120
  }),
  entry(kuu, "食う", "くう", [sense(["to eat"], { misc: ["male"], pos: ["v5u"] }), sense(["to bite"])], {
    priority: 80
  }),
  entry(meshiagaru, "召し上がる", "めしあがる", [sense(["to eat", "to drink"], { misc: ["hon"], pos: ["v5r"] })], {
    priority: 60
  }),
  entry(
    taiyaki,
    "鯛焼き",
    "たいやき",
    [sense(["taiyaki", "fish-shaped pancake filled with bean jam"], { pos: ["n"] })],
    {
      common: false,
      priority: 0
    }
  )
]

describe("normalizeGloss", () => {
  it("strips infinitive markers, articles and parentheticals", () => {
    assert.strictEqual(Dictionary.normalizeGloss("to eat (a meal)"), "eat")
    assert.strictEqual(Dictionary.normalizeGloss("The Sun"), "sun")
    assert.strictEqual(Dictionary.normalizeGloss("(of a person) to be late"), "be late")
  })
})

layer(servicesWith())("Dictionary search", (it) => {
  it.effect("finds English words by exact gloss and by stem, most common first", () =>
    Effect.gen(function* () {
      yield* Dictionary.insertEntries(words)
      assert.strictEqual(yield* Dictionary.count, 4)

      const eat = yield* Dictionary.search("eat", 10)
      assert.strictEqual(eat.mode, "english")
      assert.deepStrictEqual(
        eat.entries.map((e) => e.id),
        [taberu, kuu, meshiagaru]
      )
      assert.deepStrictEqual(eat.entries[0]?.meanings, ["to eat", "to live on (e.g. a salary)"])

      const eating = yield* Dictionary.search("eating", 10)
      assert.includeMembers(
        eating.entries.map((e) => e.id),
        [taberu, kuu, meshiagaru]
      )
    })
  )

  it.effect("finds Japanese words exactly, conjugated and by prefix", () =>
    Effect.gen(function* () {
      const exact = yield* Dictionary.search("たべる", 10)
      assert.strictEqual(exact.mode, "japanese")
      assert.strictEqual(exact.entries[0]?.id, taberu)

      const conjugated = yield* Dictionary.search("食べなかった", 10)
      assert.strictEqual(conjugated.entries[0]?.id, taberu)
      assert.isNotEmpty(conjugated.entries[0]?.inflection)

      // Prefix matches come after, common words first.
      assert.deepStrictEqual(
        (yield* Dictionary.search("た", 10)).entries.map((e) => e.id),
        [taberu, taiyaki]
      )
    })
  )

  it.effect("links words to entries, preferring one matching both spelling and reading", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* Dictionary.lookupWords([
          { word: "食う", reading: "くう" },
          { word: "存在しない", reading: "そんざいしない" }
        ]),
        [EntryId.make(kuu), null]
      )
    })
  )
})

layer(servicesWith())("Dictionary entries", (it) => {
  it.effect("assembles an entry with its enrichment and queues what's missing", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* Dictionary.insertEntries(words)
      yield* db.insert(examples).values({
        entryId: taberu,
        sense: 0,
        position: 0,
        ja: "ご飯を食べる",
        furigana: "ご{飯|はん}を{食|た}べる",
        en: "to eat a meal",
        formality: "neutral",
        note: null,
        model: "m",
        createdAt: at(0)
      })

      const page = Option.getOrThrow(yield* Dictionary.entry(EntryId.make(taberu)))
      assert.deepStrictEqual(page.senses[1]?.glosses, ["to live on (e.g. a salary)", "to subsist on"])
      assert.strictEqual(page.senses[0]?.examples[0]?.ja, "ご飯を食べる")
      // Every provider is configured here, so what's missing is queued for the worker.
      assert.deepStrictEqual(page.enrichment, { nuance: "queued", examples: "ready", audio: "queued" })
      assert.deepStrictEqual(
        [...(yield* Enrichment.statusFor(taberu))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "queued"],
          ["nuance", "queued"]
        ]
      )

      assert.isTrue(Option.isNone(yield* Dictionary.entry(EntryId.make(999))))
    })
  )
})

// The seeder reads whatever JMDict file it is given; here the "file" is whichever release is current.
const release = (
  taberuSenses: string,
  honLabel = "honorific or respectful (sonkeigo) language"
) => `<?xml version="1.0"?>
<!DOCTYPE JMdict [
<!ENTITY v1 "Ichidan verb">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY hon "${honLabel}">
]>
<JMdict>
<entry>
<ent_seq>1358280</ent_seq>
<k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
${taberuSenses}
</entry>
<entry>
<ent_seq>1001720</ent_seq>
<k_ele><keb>お菓子</keb></k_ele>
<r_ele><reb>おかし</reb></r_ele>
<sense><pos>&n;</pos><gloss>confections</gloss><gloss>sweets</gloss></sense>
</entry>
</JMdict>`

const twoSenses =
  "<sense><pos>&v1;</pos><gloss>to eat</gloss></sense>" +
  '<sense><gloss>to live on (e.g. a salary)</gloss><gloss g_type="fig">to subsist on</gloss></sense>'

let current = release(twoSenses)
const Files = FileSystem.layerNoop({ readFile: () => Effect.sync(() => new TextEncoder().encode(current)) })

const nuance = (sense: number) => {
  const judgment = { value: "neutral" as const, confidence: 0.9, source: "jev" as const }
  return {
    entryId: taberu,
    sense,
    nuance: {
      formality: { value: "neutral" as const, position: 0.5, confidence: 0.9, source: "jev" as const },
      medium: { value: "both" as const, position: 0.5, confidence: 0.8, source: "jev" as const },
      keigo: { ...judgment, value: "none" as const },
      gender: judgment,
      age: { ...judgment, value: "any" as const },
      currency: { ...judgment, value: "current" as const },
      connotation: judgment,
      cautions: { rudeToSuperiors: 0.1, stiffWithFriends: 0.1, slang: 0.05 }
    },
    answers: {},
    model: "jev-test"
  }
}

const read = (id: number) => Dictionary.entry(EntryId.make(id)).pipe(Effect.map(Option.getOrThrow))

// Dictionary and enrichment are rebuildable, so moving to a new JMDict release is a reseed:
// the seeder upserts, and enrichment for senses that still exist must survive it.
layer(Layer.merge(servicesWith(), Files))("Dictionary.importFile", (it) => {
  it.effect("seeding twice leaves the same dictionary, enrichment and queue", () =>
    Effect.gen(function* () {
      const db = yield* Database
      assert.deepStrictEqual(yield* Dictionary.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      const seeded = yield* read(taberu)
      assert.strictEqual(seeded.senses[0]?.partsOfSpeech[0]?.label, "Ichidan verb")

      yield* db.insert(senseNuance).values([nuance(0), nuance(1)])
      yield* db.insert(examples).values({
        entryId: taberu,
        sense: 1,
        position: 0,
        ja: "給料で食べる。",
        furigana: "",
        en: "Live on a salary.",
        formality: "neutral",
        note: null,
        model: "m",
        createdAt: at(0)
      })
      yield* Enrichment.enqueue("audio", taberu, 10)

      assert.deepStrictEqual(yield* Dictionary.importFile({ file: "JMdict_e.gz" }), { entries: 2, tags: 3 })
      assert.strictEqual(yield* Dictionary.count, 2)
      const reseeded = yield* read(taberu)
      assert.deepStrictEqual(reseeded.forms, seeded.forms)
      assert.deepStrictEqual(
        reseeded.senses.map((s) => [s.glosses, s.nuance?.formality.value, s.examples.length]),
        [
          [["to eat"], "neutral", 0],
          [["to live on (e.g. a salary)", "to subsist on"], "neutral", 1]
        ]
      )
      assert.strictEqual((yield* Enrichment.statusFor(taberu)).get("audio"), "queued")
    })
  )

  it.effect("a newer release updates in place and drops only the enrichment of senses it lost", () =>
    Effect.gen(function* () {
      current = release("<sense><pos>&v1;</pos><gloss>to eat</gloss><gloss>to have a meal</gloss></sense>", "honorific")

      yield* Dictionary.importFile({ file: "JMdict_e.gz" })
      const updated = yield* read(taberu)
      assert.deepStrictEqual(
        updated.senses.map((s) => [s.glosses, s.nuance?.formality.value, s.examples.length]),
        [[["to eat", "to have a meal"], "neutral", 0]]
      )
      assert.strictEqual(yield* Dictionary.count, 2)
      assert.strictEqual((yield* Dictionary.search("お菓子", 1)).entries[0]?.meanings.join("; "), "confections; sweets")
    })
  )
})
