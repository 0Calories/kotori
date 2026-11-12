import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { cautions, entryFrequency, examples, labels, loanLinks, usagePatterns } from "@kotori/db"
import { asc, eq } from "drizzle-orm"
import { Effect, FileSystem, Layer } from "effect"
import { Database } from "../../src/db/Database.ts"
import * as JMDict from "../../src/features/dictionary/import/jmdict/JMDict.ts"
import { getEntries, insertEntries, linkLoans } from "../../src/features/dictionary/queries.ts"
import { examplesFor, saveExamples } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { sense, spelling } from "../fixtures.ts"

// The seed import's facts beside the entries: labels and usage patterns from the senses, Tatoeba's
// sentences, frequency signals and loan links. A re-import rebuilds the dictionary's own and leaves
// Kotori's in place, following their sense.

const kuu = EntryId.make(1335590)
const gokurou = EntryId.make(1270560)
const mansion = EntryId.make(1079450)
const mansionEn = EntryId.make(100_000_001)
const yep = EntryId.make(100_000_002)

const eat = `<sense><pos>&v5u;</pos><misc>&male;</misc><gloss>to eat</gloss>
<example><ex_srce exsrc_type="tat">1</ex_srce><ex_text>食う</ex_text>
<ex_sent xml:lang="jpn">飯を食おう。</ex_sent><ex_sent xml:lang="eng">Let's eat.</ex_sent></example></sense>`
const live = "<sense><misc>&col;</misc><gloss>to live</gloss><gloss>to make a living</gloss></sense>"
const bite = "<sense><gloss>to bite</gloss></sense>"

const release = (
  kuuSenses: string,
  mansionSource = '<lsource xml:lang="eng">mansion</lsource>',
  mansionSpelling = "マンション"
) => `<?xml version="1.0"?>
<!DOCTYPE JMdict [
<!ENTITY v5u "Godan verb with 'u' ending">
<!ENTITY male "male term or language">
<!ENTITY col "colloquial">
<!ENTITY pol "polite (teineigo) language">
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
<entry><ent_seq>${kuu}</ent_seq><k_ele><keb>食う</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>くう</reb></r_ele>
${kuuSenses}</entry>
<entry><ent_seq>${gokurou}</ent_seq><k_ele><keb>ご苦労様</keb></k_ele><r_ele><reb>ごくろうさま</reb></r_ele>
<sense><misc>&pol;</misc><s_inf>usu. to one's subordinate</s_inf><gloss>thank you for your hard work</gloss></sense></entry>
<entry><ent_seq>${mansion}</ent_seq><r_ele><reb>${mansionSpelling}</reb></r_ele>
<sense><pos>&n;</pos>${mansionSource}<gloss>condominium</gloss></sense></entry>
</JMdict>`

let current = release(eat + live)
const Files = FileSystem.layerNoop({ readFile: () => Effect.sync(() => new TextEncoder().encode(current)) })
const TestLayer = Files.pipe(Layer.provideMerge(DatabaseMemory))

const english = (id: EntryId, headword: string, misc: Array<string> = []) => ({
  id,
  language: "en" as const,
  source: "enwiktionary" as const,
  headword,
  reading: "",
  common: true,
  priority: 50,
  forms: [spelling(headword, true)],
  senses: [sense(["ことば"], { misc })],
  frequency: { everyday: true, spokenCount: 1200, score: 4 }
})

const labelsOf = (entryId: EntryId) =>
  Effect.gen(function* () {
    const db = yield* Database
    return yield* db
      .select({ sense: labels.sense, code: labels.code, source: labels.source })
      .from(labels)
      .where(eq(labels.entryId, entryId))
      .orderBy(asc(labels.sense), asc(labels.code))
  })

layer(TestLayer)("seed facts", (it) => {
  it.effect("reads labels, usage patterns, evidence, Tatoeba's sentences and loan links from JMDict", () =>
    Effect.gen(function* () {
      const db = yield* Database
      current = release(eat + live)
      yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })

      assert.deepStrictEqual(yield* labelsOf(kuu), [
        { sense: 0, code: "male", source: "jmdict" },
        { sense: 1, code: "col", source: "jmdict" }
      ])
      assert.deepStrictEqual(yield* labelsOf(gokurou), [{ sense: 0, code: "pol", source: "jmdict" }])
      const notes = yield* db.select().from(usagePatterns).where(eq(usagePatterns.entryId, gokurou))
      assert.deepStrictEqual(
        notes.map(({ text, source }) => ({ text, source })),
        [{ text: "usu. to one's subordinate", source: "jmdict" }]
      )

      // ichi1 speaks for 食う; nothing speaks for the other two, so they have no row.
      const frequency = yield* db.select().from(entryFrequency)
      assert.deepStrictEqual(frequency, [{ entryId: kuu, everyday: true, spokenCount: null, score: null }])

      const [sentence] = yield* examplesFor(db, [kuu])
      assert.deepStrictEqual(
        sentence && {
          sense: sentence.sense,
          ja: sentence.ja,
          furigana: sentence.furigana,
          en: sentence.en,
          formality: sentence.formality,
          source: sentence.source,
          model: sentence.model
        },
        {
          sense: 0,
          ja: "飯を食おう。",
          furigana: "飯を食おう。",
          en: "Let's eat.",
          formality: null,
          source: "tatoeba",
          model: null
        }
      )

      const [link] = yield* db.select().from(loanLinks)
      assert.deepStrictEqual(link && { ...link, id: 0 }, {
        id: 0,
        katakana: "マンション",
        katakanaEntryId: mansion,
        english: "mansion",
        englishEntryId: null,
        meaning: null,
        source: "jmdict",
        meaningSource: null
      })
    })
  )

  it.effect("gives English words their source's labels and frequency, and links a loan to its English word", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [english(mansionEn, "mansion"), english(yep, "yep", ["col", "countable"])], {
        seeded: true
      })
      yield* linkLoans(db)

      // `countable` is the prior, not a label.
      assert.deepStrictEqual(yield* labelsOf(yep), [{ sense: 0, code: "col", source: "enwiktionary" }])
      const [frequency] = yield* db.select().from(entryFrequency).where(eq(entryFrequency.entryId, yep))
      assert.deepStrictEqual(frequency, { entryId: yep, everyday: true, spokenCount: 1200, score: 4 })
      const [link] = yield* db.select().from(loanLinks)
      assert.strictEqual(link?.englishEntryId, mansionEn)
    })
  )

  it.effect(
    "re-importing keeps seeded sentence ids and Kotori's sentences, and a dictionary label replaces Kotori's",
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        current = release(eat + live)
        yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })
        const [seeded] = yield* examplesFor(db, [kuu])

        // Kotori writes its own sentences: the seeded one stays, after them.
        yield* saveExamples(
          db,
          kuu,
          [
            {
              sense: 0,
              ja: "腹減った、何か食おうぜ。",
              furigana: "腹減った、何か食おうぜ。",
              en: "I'm starving, let's grab something.",
              formality: "casual",
              model: "claude-test"
            }
          ],
          new Date(0)
        )
        // Kotori fills `col` on sense 0, where JMDict is silent, and `form` on ご苦労様.
        yield* db.insert(labels).values([
          { entryId: kuu, sense: 0, code: "col", source: "kotori" },
          { entryId: gokurou, sense: 0, code: "form", source: "kotori" }
        ])

        // The next release marks sense 0 colloquial itself.
        current = release(eat.replace("<misc>&male;</misc>", "<misc>&male;</misc><misc>&col;</misc>") + live)
        yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })

        const sentences = yield* examplesFor(db, [kuu])
        assert.deepStrictEqual(
          sentences.map((row) => row.source),
          ["kotori", "tatoeba"]
        )
        assert.strictEqual(sentences[1]?.id, seeded?.id)
        assert.deepStrictEqual(yield* labelsOf(kuu), [
          { sense: 0, code: "col", source: "jmdict" },
          { sense: 0, code: "male", source: "jmdict" },
          { sense: 1, code: "col", source: "jmdict" }
        ])
        assert.deepStrictEqual(yield* labelsOf(gokurou), [
          { sense: 0, code: "form", source: "kotori" },
          { sense: 0, code: "pol", source: "jmdict" }
        ])
      })
  )

  it.effect(
    "Kotori's labels, usage patterns and cautions follow a sense the re-import moves, and go with one it drops",
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        current = release(eat + live)
        yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })
        yield* db.delete(labels).where(eq(labels.source, "kotori"))
        yield* db.insert(labels).values([
          { entryId: kuu, sense: 0, code: "col", source: "kotori" },
          { entryId: kuu, sense: 1, code: "form", source: "kotori" }
        ])
        yield* db.insert(usagePatterns).values([
          { entryId: kuu, sense: 0, position: 0, text: "Rough; 食べる is the everyday word.", source: "kotori" },
          { entryId: kuu, sense: 1, position: 0, text: "As in 食っていく.", source: "kotori" }
        ])
        yield* db.insert(cautions).values([
          { entryId: kuu, sense: 0, rank: 1, kind: "rude_upward", text: "Rough said upward.", source: "kotori" },
          { entryId: kuu, sense: null, rank: 2, kind: "confusable", text: "Not 喰う.", source: "kotori" }
        ])

        // A new first sense pushes "to eat" to 1, and "to live" is gone.
        current = release(bite + eat)
        yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })

        assert.deepStrictEqual(yield* labelsOf(kuu), [
          { sense: 1, code: "col", source: "kotori" },
          { sense: 1, code: "male", source: "jmdict" }
        ])
        const kotoriNotes = yield* db
          .select({ sense: usagePatterns.sense, text: usagePatterns.text })
          .from(usagePatterns)
          .where(eq(usagePatterns.entryId, kuu))
        assert.deepStrictEqual(kotoriNotes, [{ sense: 1, text: "Rough; 食べる is the everyday word." }])
        const kept = yield* db
          .select({ sense: cautions.sense, rank: cautions.rank })
          .from(cautions)
          .where(eq(cautions.entryId, kuu))
          .orderBy(asc(cautions.rank))
        assert.deepStrictEqual(kept, [
          { sense: 1, rank: 1 },
          { sense: null, rank: 2 }
        ])
        const sentences = yield* db.select({ sense: examples.sense, source: examples.source }).from(examples)
        assert.deepStrictEqual(
          sentences.filter((row) => row.source === "tatoeba"),
          [{ sense: 1, source: "tatoeba" }]
        )
      })
  )

  it.effect("drops a loan link JMDict no longer names, and an alias re-insert leaves seeded facts alone", () =>
    Effect.gen(function* () {
      const db = yield* Database
      current = release(eat + live, "")
      yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })
      assert.strictEqual(yield* db.$count(loanLinks), 0)

      // Re-inserting a stored entry (as an approved alias does) carries no examples or evidence,
      // and leaves the seeded ones as they were.
      const seeded = yield* examplesFor(db, [kuu])
      assert.isAbove(seeded.length, 0)
      yield* insertEntries(db, yield* getEntries(db, [kuu]))
      assert.deepStrictEqual(
        (yield* examplesFor(db, [kuu])).map((row) => row.id),
        seeded.map((row) => row.id)
      )
      assert.strictEqual(yield* db.$count(entryFrequency, eq(entryFrequency.entryId, kuu)), 1)
    })
  )

  it.effect("moves a loan link with its katakana word when JMDict respells it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      // Each import links loans as it finishes.
      current = release(eat + live)
      yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })
      current = release(eat + live, '<lsource xml:lang="eng">mansion</lsource>', "マンシヨン")
      yield* JMDict.importFile({ file: "JMdict_e_examp.gz" })

      const links = yield* db.select({ katakana: loanLinks.katakana, entry: loanLinks.katakanaEntryId }).from(loanLinks)
      assert.deepStrictEqual(links, [{ katakana: "マンシヨン", entry: mansion }])
    })
  )

  it.effect("drops an approved word's Kotori labels and notes when the curated file takes it over", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const rizz = EntryId.make(100_000_003)
      const approved = { ...english(rizz, "rizz", ["sl"]), source: "kotori" as const }
      yield* insertEntries(db, [
        { ...approved, senses: [sense(["魅力"], { misc: ["sl"], info: ["Said of a person."] })] }
      ])
      assert.deepStrictEqual(yield* labelsOf(rizz), [{ sense: 0, code: "sl", source: "kotori" }])

      yield* insertEntries(db, [english(rizz, "rizz", ["col"])], { seeded: true })
      assert.deepStrictEqual(yield* labelsOf(rizz), [{ sense: 0, code: "col", source: "enwiktionary" }])
      assert.strictEqual(yield* db.$count(usagePatterns, eq(usagePatterns.entryId, rizz)), 0)
    })
  )
})
