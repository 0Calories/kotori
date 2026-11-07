import { assert, describe, it, layer } from "@effect/vitest"
import { EntryId, type EntryRecord, NoteId } from "@kotori/contracts"
import { Effect, Exit } from "effect"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { matchSenses } from "../../src/features/dictionary/import/matchSenses.ts"
import {
  countOf,
  deleteEntries,
  entriesByPriority,
  entryCount,
  findFormPrefix,
  findForms,
  findGlossesExact,
  findJapaneseGlosses,
  getEntries,
  headwordIds,
  insertEntries,
  searchForms,
  searchFormsFuzzy,
  searchGlosses,
  searchGlossesFuzzy,
  searchJapaneseGlosses
} from "../../src/features/dictionary/queries.ts"
import { examplesFor, saveExamples } from "../../src/features/enrichment/queries.ts"
import { insertNote, notesWithCards } from "../../src/features/study/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, kanji, learner, sense, spelling, U1 } from "../fixtures.ts"

const TestLayer = DatabaseMemory

layer(TestLayer)("dictionary queries", (it) => {
  it.effect("imports entries and reads them back in order", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, entries)
      yield* insertEntries(db, english)
      assert.strictEqual(yield* entryCount(db), 8)
      assert.strictEqual(yield* countOf(db, "ja"), 4)
      assert.strictEqual(yield* countOf(db, "en"), 4)

      const [taberu] = yield* getEntries(db, [EntryId.make(1358280)])
      assert.strictEqual(taberu?.headword, "食べる")
      assert.deepStrictEqual(
        taberu?.forms.map((form) => form.text),
        ["食べる", "たべる"]
      )
      assert.strictEqual(taberu?.senses[1]?.glosses[0]?.text, "to live on (e.g. a salary)")
    })
  )

  it.effect("imports a batch completely or not at all", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const before = yield* entryCount(db)
      const fine: EntryRecord = { ...entries[0]!, id: EntryId.make(9_000_000) }
      // A form the database refuses (no such form kind), written after the batch's entries.
      const broken: EntryRecord = {
        ...entries[0]!,
        id: EntryId.make(9_000_001),
        forms: [{ ...kanji("壊れる"), kind: "scribble" as never }]
      }
      const imported = yield* insertEntries(db, [fine, broken]).pipe(Effect.exit)
      assert.isTrue(Exit.isFailure(imported))
      assert.strictEqual(yield* entryCount(db), before)
      assert.deepStrictEqual(yield* getEntries(db, [fine.id]), [])
    })
  )

  it.effect("re-importing an entry replaces it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [{ ...entries[3]!, priority: 5 }])
      const [taiyaki] = yield* getEntries(db, [EntryId.make(1000000)])
      assert.strictEqual(taiyaki?.priority, 5)
      assert.strictEqual(taiyaki?.forms.length, 2)
    })
  )

  it.effect("finds Japanese forms exactly and by prefix", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const exact = yield* findForms(db, ["たべる"])
      assert.deepStrictEqual(
        exact.map((match) => match.entryId),
        [1358280]
      )
      assert.deepStrictEqual(yield* findFormPrefix(db, "た", 10), [1358280, 1000000])
    })
  )

  it.effect("searches English glosses with stemming and exact matching", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const fts = yield* searchGlosses(db, ["eating"], 20)
      assert.includeMembers(
        fts.map((match) => match.entryId),
        [1358280, 1269130, 1594790]
      )

      const exact = yield* findGlossesExact(db, "Eat", 20)
      assert.deepStrictEqual(
        exact.map((match) => match.entryId),
        [1358280, 1269130, 1594790]
      )

      const relaxed = yield* searchGlosses(db, ["pancake jam", "pancake soup"], 20)
      assert.include(
        relaxed.map((match) => match.entryId),
        EntryId.make(1000000)
      )

      const fuzzy = yield* searchGlossesFuzzy(db, "pancak filled with bean jam", 20)
      assert.include(
        fuzzy.map((match) => match.entryId),
        EntryId.make(1000000)
      )
    })
  )

  it.effect("lists entries missing enrichment in priority order", () =>
    Effect.gen(function* () {
      const db = yield* Database
      assert.deepStrictEqual(
        yield* entriesByPriority(db, { limit: 2, missing: "examples", language: "ja" }),
        [1358280, 1269130]
      )
      assert.deepStrictEqual(
        yield* entriesByPriority(db, { limit: 10, commonOnly: true, language: "ja" }),
        [1358280, 1269130, 1594790]
      )
      assert.deepStrictEqual(
        yield* entriesByPriority(db, { limit: 10, commonOnly: true, language: "en" }),
        [100000001, 100000003]
      )
    })
  )

  it.effect("keeps each dictionary's lookups to its own words", () =>
    Effect.gen(function* () {
      const db = yield* Database
      // Japanese glosses of English words aren't English glosses of Japanese words.
      assert.notInclude(
        (yield* findGlossesExact(db, "eat", 20)).map((match) => match.entryId),
        EntryId.make(100000001)
      )
      assert.deepStrictEqual(yield* findForms(db, ["eat"]), [])
      assert.deepStrictEqual(yield* findForms(db, ["たべる"], "en"), [])
    })
  )

  it.effect("finds English words whatever their case, and by their inflections", () =>
    Effect.gen(function* () {
      const db = yield* Database
      assert.sameMembers(
        (yield* findForms(db, ["POLISH"], "en")).map((match) => match.entryId),
        [100000002, 100000003]
      )
      const [ate] = yield* findForms(db, ["Ate"], "en")
      assert.deepStrictEqual([ate?.entryId, ate?.kind, ate?.tags], [100000001, "inflection", ["past"]])
      // Prefixes find headwords and spellings, not inflections: "eate" isn't the start of a word.
      assert.deepStrictEqual(yield* findFormPrefix(db, "Po", 10, "en"), [100000003, 100000002])
      assert.deepStrictEqual(yield* findFormPrefix(db, "eate", 10, "en"), [])
      assert.deepStrictEqual(yield* findFormPrefix(db, "た", 10, "en"), [])
      assert.sameMembers(
        (yield* searchForms(db, ["polishing"], 10)).map((match) => match.entryId),
        [100000002, 100000003]
      )
      assert.sameMembers(
        (yield* searchFormsFuzzy(db, "polsh", 10)).map((match) => match.entryId),
        [100000002, 100000003]
      )
    })
  )

  it.effect("finds a phrase made only of common words by its words", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        {
          id: EntryId.make(100000050),
          language: "en",
          dictionary: "enwiktionary",
          headword: "it is what it is",
          reading: "",
          common: false,
          priority: 0,
          forms: [spelling("it is what it is")],
          senses: [sense(["しょうがない"], { pos: ["exp"] })]
        }
      ])
      // Every word is one the English configuration drops, so the phrase is indexed word for word.
      assert.deepStrictEqual(
        (yield* searchForms(db, ["what it is"], 10)).map((match) => match.text),
        ["it is what it is"]
      )
      // A query with a word of its own still stems: "eating" finds "eat", not the phrase.
      assert.notInclude(
        (yield* searchForms(db, ["eating"], 10)).map((match) => match.text),
        "it is what it is"
      )
      yield* deleteEntries(db, [EntryId.make(100000050)])
    })
  )

  it.effect("filters out weak multi-word trigram lookalikes in fuzzy form search", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        {
          id: EntryId.make(100000090),
          language: "en",
          dictionary: "enwiktionary",
          headword: "throw on",
          reading: "",
          common: true,
          priority: 60,
          forms: [spelling("throw on", true)],
          senses: [sense(["羽織る"])]
        },
        {
          id: EntryId.make(100000091),
          language: "en",
          dictionary: "enwiktionary",
          headword: "think of",
          reading: "",
          common: true,
          priority: 60,
          forms: [spelling("think of", true)],
          senses: [sense(["思いつく"])]
        }
      ])
      assert.deepStrictEqual(yield* searchFormsFuzzy(db, "on thin ice", 10), [])
      yield* deleteEntries(db, [EntryId.make(100000090), EntryId.make(100000091)])
    })
  )

  it.effect("looks up the Japanese glosses of English words", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const exact = yield* findJapaneseGlosses(db, ["食べる"], 20)
      assert.deepStrictEqual(
        exact.map((match) => [match.entryId, match.text]),
        [[100000001, "～を食べる。"]]
      )
      assert.deepStrictEqual(
        (yield* searchJapaneseGlosses(db, "食事", 20)).map((match) => match.entryId),
        [100000001, 100000004]
      )
      // LIKE wildcards in a query are taken literally.
      assert.deepStrictEqual(yield* searchJapaneseGlosses(db, "%", 20), [])
      assert.deepStrictEqual(
        [...(yield* headwordIds(db, "en"))].sort(([, a], [, b]) => a - b),
        [
          ["eat", 100000001],
          ["Polish", 100000002],
          ["polish", 100000003],
          ["dine", 100000004]
        ]
      )
    })
  )
})

describe("matchSenses", () => {
  it("follows each stored sense to the incoming one with its glosses", () => {
    const [a, b, c] = [["型", "様式"], ["やり方"], ["格好"]]
    assert.deepStrictEqual(matchSenses([a, b, c], [a, b, c]), [0, 1, 2])
    assert.deepStrictEqual(matchSenses([a, b, c], [c, a, b]), [1, 2, 0])
    // An edit that keeps half the glosses is the same sense, wherever it went.
    assert.deepStrictEqual(matchSenses([a, b, c], [["やり方", "方法"], a]), [1, 0, null])
    // One that keeps less stays at its position, as a sense reworded in place, unless another
    // sense moved there.
    assert.deepStrictEqual(matchSenses([["型", "様式", "流儀"]], [["型", "スタイル", "流行"]]), [0])
    assert.deepStrictEqual(matchSenses([["to eat"], ["to drink"]], [["to eat (a meal)"], ["to drink"]]), [0, 1])
    assert.deepStrictEqual(matchSenses([a, ["流儀"]], [["流儀"], ["格好"]]), [null, 0])
    // Twin senses keep their order; an incoming sense is taken once.
    assert.deepStrictEqual(matchSenses([b, b, a], [a, b, b]), [1, 2, 0])
    assert.deepStrictEqual(matchSenses([a, ["型"]], [a]), [0, null])
  })
})

layer(TestLayer)("dictionary re-imports", (it) => {
  it.effect("move what is keyed by sense with its sense, and drop what belonged to a sense that is gone", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const style = EntryId.make(100000500)
      const word = (senses: Array<Array<string>>): EntryRecord => ({
        id: style,
        language: "en",
        dictionary: "enwiktionary",
        headword: "style",
        reading: "",
        common: true,
        priority: 80,
        forms: [spelling("style", true)],
        senses: senses.map((glosses) => sense(glosses))
      })
      const [form, way, look, pistil] = [["型", "様式"], ["やり方"], ["格好"], ["花柱"]]
      yield* insertEntries(db, [word([form, way, look, pistil])])

      // Each sense's sentence and saved word names it by its first gloss.
      const markers = ["型", "やり方", "格好", "花柱"]
      yield* saveExamples(
        db,
        style,
        markers.map((marker, sense) => ({
          sense,
          ja: marker,
          furigana: marker,
          en: `${marker} sentence`,
          formality: "neutral" as const,
          note: null,
          model: "claude"
        })),
        new Date(0)
      )
      const sentenceIds = new Map((yield* examplesFor(db, [style])).map((row) => [row.ja, row.id]))
      const saveWord = (id: string, sense: number) =>
        insertNote(
          scopedToUser(db, U1),
          {
            id: NoteId.make(id),
            kind: "word",
            content: {
              kind: "word",
              entryId: style,
              senseIndex: sense,
              language: "en",
              headword: "style",
              reading: "",
              meaning: markers[sense]!,
              hint: null,
              example: null,
              audioUrl: null
            },
            entryId: style,
            sense,
            createdAt: new Date(0)
          },
          []
        )
      yield* saveWord("00000000-0000-4000-8000-0000000000e1", 2)
      yield* saveWord("00000000-0000-4000-8000-0000000000e2", 3)
      yield* saveWord("00000000-0000-4000-8000-0000000000e3", 0)

      // The re-import ranks 格好 first, edits やり方, and drops 花柱.
      yield* insertEntries(db, [word([look, form, ["やり方", "方法"]])])

      const [entry] = yield* getEntries(db, [style])
      assert.deepStrictEqual(
        entry?.senses.map((s) => s.glosses.map((g) => g.text)),
        [look, form, ["やり方", "方法"]]
      )
      const bySense = <R extends { readonly sense: number }>(rows: ReadonlyArray<R>, read: (row: R) => unknown) =>
        rows.toSorted((a, b) => a.sense - b.sense).map((row) => [row.sense, read(row)])
      // Sentences keep their ids, and so their audio; the dropped sense's sentence goes.
      const sentences = yield* examplesFor(db, [style])
      assert.deepStrictEqual(
        bySense(sentences, (row) => [row.ja, row.id]),
        [
          [0, ["格好", sentenceIds.get("格好")]],
          [1, ["型", sentenceIds.get("型")]],
          [2, ["やり方", sentenceIds.get("やり方")]]
        ]
      )
      // Saved words follow in the column and the card content; the dropped sense's loses its place.
      const saved = (yield* notesWithCards(scopedToUser(db, U1))).flatMap((note) =>
        note.content.kind === "word" ? [[note.content.meaning, note.sense, note.content.senseIndex]] : []
      )
      assert.sameDeepMembers(saved, [
        ["格好", 0, 0],
        ["花柱", null, -1],
        ["型", 1, 1]
      ])

      // Re-importing the same senses moves nothing.
      yield* insertEntries(db, [word([look, form, ["やり方", "方法"]])])
      assert.strictEqual((yield* examplesFor(db, [style])).length, 3)
    })
  )
})
