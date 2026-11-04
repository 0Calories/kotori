import { assert, describe, it, layer } from "@effect/vitest"
import { EntryId, type EntryRecord, NoteId } from "@kotori/contracts"
import { type LoanCandidate, loanCandidatesIn, normalizeGloss } from "@kotori/language"
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
  loanCandidates,
  searchForms,
  searchFormsFuzzy,
  searchGlosses,
  searchGlossesFuzzy,
  searchJapaneseGlosses,
  sharedGlossCandidates
} from "../../src/features/dictionary/queries.ts"
import {
  examplesFor,
  nuanceFor,
  saveExamples,
  saveNuance,
  saveSenseNotes,
  saveSimilar,
  senseNotesFor,
  similarFor
} from "../../src/features/enrichment/queries.ts"
import { insertNote, notesWithCards } from "../../src/features/study/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, kana, kanji, learner, sense, spelling, U1 } from "../fixtures.ts"

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

  it.effect("suggests words sharing a meaning as similar-word candidates", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const candidates = yield* sharedGlossCandidates(db, EntryId.make(1358280), 0, 10)
      assert.deepStrictEqual(
        candidates.map((c) => c.entryId),
        [1269130, 1594790]
      )
      assert.deepStrictEqual(yield* sharedGlossCandidates(db, EntryId.make(1358280), 1, 10), [])
    })
  )

  it.effect("lists entries missing enrichment in priority order", () =>
    Effect.gen(function* () {
      const db = yield* Database
      assert.deepStrictEqual(
        yield* entriesByPriority(db, { limit: 2, missing: "nuance", language: "ja" }),
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
      // 食べる and 食う share "to eat"; eat and dine share 食事をする, and never a Japanese word.
      assert.deepStrictEqual(
        (yield* sharedGlossCandidates(db, EntryId.make(100000001), 1, 10)).map((c) => c.entryId),
        [100000004]
      )
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

  it.effect("filters out weak multi-word trigram lookalikes in fuzzy form search", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        {
          id: EntryId.make(100000090),
          language: "en",
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

  it.effect("finds the katakana words that may be an English word's loan, by gloss or by JMDict source", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const loan = (
        id: number,
        word: string,
        priority: number,
        senses: Array<ReturnType<typeof sense>>,
        common = true
      ): EntryRecord => ({
        id: EntryId.make(id),
        language: "ja",
        headword: word,
        reading: word,
        common,
        priority,
        forms: [kana(word, common)],
        senses
      })
      const loans: Array<EntryRecord> = [
        loan(9100001, "スタイル", 60, [sense(["(one's) figure", "physique"]), sense(["style"])]),
        loan(9100002, "タイプ", 40, [sense(["type", "kind", "style"])]),
        loan(9100003, "マンション", 60, [sense(["condominium", "apartment building"], { sources: ["mansion"] })]),
        // Gloss matches give false candidates too: トラック is the loan of "truck", not "lorry".
        loan(9100004, "トラック", 60, [sense(["truck", "lorry"])]),
        loan(9100005, "タレント", 60, [sense(["talent", "skill"], { sources: ["talent"] })]),
        loan(9100006, "ウォーク", 0, [sense(["walk"])], false),
        {
          id: EntryId.make(9100007),
          language: "ja",
          headword: "様式",
          reading: "ようしき",
          common: true,
          priority: 90,
          forms: [kanji("様式"), kana("ようしき")],
          senses: [sense(["style", "form"])]
        }
      ]
      yield* insertEntries(db, loans)

      const words = ["style", "mansion", "lorry", "talent", "to walk"]
      const found = yield* loanCandidates(db, words, 3)
      const byWord = (candidates: ReadonlyArray<LoanCandidate>) =>
        Object.fromEntries(
          words
            .map(normalizeGloss)
            .map((word) => [word, candidates.filter((c) => c.word === word).map((c) => `${c.entryId}:${c.by}`)])
        )
      assert.deepStrictEqual(byWord(found), {
        // Kanji words aren't loans; the more frequent loan comes first.
        style: ["9100001:gloss", "9100002:gloss"],
        // Only JMDict's lsource ties マンション to "mansion".
        mansion: ["9100003:source"],
        lorry: ["9100004:gloss"],
        // A source beats a gloss as the reason.
        talent: ["9100005:source"],
        // Uncommon words aren't everyday loans.
        walk: []
      })
      assert.deepStrictEqual(byWord(yield* loanCandidates(db, words, 1)).style, ["9100001:gloss"])
      // The same search over parsed entries, which cuts the golden fixture, agrees with the SQL.
      assert.deepStrictEqual(byWord(loanCandidatesIn(loans, words, 3)), byWord(found))
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
        headword: "style",
        reading: "",
        common: true,
        priority: 80,
        forms: [spelling("style", true)],
        senses: senses.map((glosses) => sense(glosses))
      })
      const [form, way, look, pistil] = [["型", "様式"], ["やり方"], ["格好"], ["花柱"]]
      yield* insertEntries(db, [word([form, way, look, pistil])])
      const type = EntryId.make(style + 1)
      yield* insertEntries(db, [{ ...word([["型"]]), id: type, headword: "type" }])

      // Each sense's judgment, note, similar word and sentence names it by its first gloss.
      const judged = (marker: string) => ({
        formality: { value: "neutral" as const, position: 0.5, confidence: 0.9, source: "jev" as const },
        medium: { value: "both" as const, position: 0.5, confidence: 0.9, source: "jev" as const },
        keigo: { value: "none" as const, confidence: 1, source: "jmdict" as const },
        gender: { value: "neutral" as const, confidence: 0.9, source: "jev" as const },
        age: { value: "any" as const, confidence: 0.9, source: "jev" as const },
        currency: { value: "current" as const, confidence: 0.9, source: "jev" as const },
        connotation: { value: "neutral" as const, confidence: 0.9, source: "jev" as const },
        cautions: { rudeToSuperiors: 0.1, stiffWithFriends: 0.1, slang: 0.1 },
        marker
      })
      const markers = ["型", "やり方", "格好", "花柱"]
      yield* saveNuance(
        db,
        style,
        markers.map((marker, sense) => ({
          sense,
          nuance: judged(marker) as never,
          answers: { marker },
          model: "jev",
          questionsVersion: 3
        })),
        new Date(0)
      )
      yield* saveSenseNotes(
        db,
        style,
        markers.map((marker, sense) => ({ sense, note: null, noteJa: marker, model: "claude" })),
        new Date(0)
      )
      yield* saveSimilar(db, style, [
        { sense: 0, similarId: type, similarity: 0.9, difference: "more_general", confidence: 0.8 }
      ])
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
      assert.deepStrictEqual(
        bySense(yield* nuanceFor(db, [style]), (row) => (row.nuance as unknown as { marker: string }).marker),
        [
          [0, "格好"],
          [1, "型"],
          [2, "やり方"]
        ]
      )
      assert.deepStrictEqual(
        bySense(yield* senseNotesFor(db, [style]), (row) => row.noteJa),
        [
          [0, "格好"],
          [1, "型"],
          [2, "やり方"]
        ]
      )
      assert.deepStrictEqual(
        bySense(yield* similarFor(db, style), (row) => row.similarId),
        [[1, style + 1]]
      )
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
      assert.strictEqual((yield* nuanceFor(db, [style])).length, 3)
      assert.strictEqual((yield* examplesFor(db, [style])).length, 3)
    })
  )
})
