import { afterAll, assert, layer } from "@effect/vitest"
import { EntryId, type EntryRecord, NoteId, UserId } from "@kotori/contracts"
import { Effect, Layer, Option } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { discardEntry, mergeEntry } from "../../src/features/asks/review.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import * as EnglishDictionary from "../../src/features/dictionary/import/english/EnglishDictionary.ts"
import { NotedEntriesWouldBeDeleted } from "../../src/features/dictionary/import/english/staleEntries.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { allNotes, insertNote } from "../../src/features/notebook/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { learner, U1 } from "../fixtures.ts"

const directory = mkdtempSync(join(tmpdir(), "english-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const file = (name: string, lines: ReadonlyArray<string>) => {
  const path = join(directory, name)
  writeFileSync(path, lines.join("\n"))
  return path
}

const line = (word: string, pos: string, glosses: Array<string>, extra: object = {}) =>
  JSON.stringify({ word, lang_code: "en", pos, senses: glosses.map((gloss) => ({ glosses: [gloss] })), ...extra })

const wiktionary = (withWalk: boolean) => [
  line("eat", "verb", ["～を食べる。"], { forms: [{ form: "eats", tags: ["third-person", "singular", "present"] }] }),
  line("ate", "verb", ["eatの過去形"]),
  line("May", "noun", ["5月"]),
  line("may", "verb", ["～かもしれない"]),
  ...(withWalk ? [line("walk", "verb", ["歩く。"])] : []),
  JSON.stringify({ word: "eat", lang_code: "de", pos: "verb", senses: [{ glosses: ["食べる。"] }] })
]

const jmdict = `<?xml version="1.0"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY exp "Expressions (phrases, clauses, etc.)">
<!ENTITY v5m "Godan verb with 'mu' ending">
<!ENTITY id "idiomatic expression">
]>
<JMdict>
<entry><ent_seq>1000010</ent_seq><k_ele><keb>自撮り</keb></k_ele><r_ele><reb>じどり</reb></r_ele><sense><pos>&n;</pos><gloss>selfie</gloss></sense></entry>
<entry><ent_seq>1000020</ent_seq><k_ele><keb>薄氷を踏む</keb></k_ele><r_ele><reb>はくひょうをふむ</reb></r_ele><sense><pos>&exp;</pos><pos>&v5m;</pos><misc>&id;</misc><gloss>to tread on thin ice</gloss><gloss>to walk on thin ice</gloss></sense></entry>
</JMdict>`

const files = (withWalk: boolean) => ({
  curated: file("curated.jsonl", [
    JSON.stringify({
      headword: "twerk",
      ipa: "/twɜɹk/",
      frequency: 3,
      inflections: [{ text: "twerking", tags: ["present-participle"] }],
      senses: [{ pos: ["v"], glosses: ["トゥワークする"] }]
    }),
    JSON.stringify({
      headword: "on thin ice",
      ipa: "/ɒn ˈθɪn ˈaɪs/",
      frequency: 5,
      spellings: ["skate on thin ice"],
      senses: [{ pos: ["exp"], misc: ["id"], glosses: ["薄氷を踏む", "危ない橋を渡る"] }]
    })
  ]),
  phrases: file("phrases.json", [
    JSON.stringify({ phrases: ["on thin ice"], redirects: { "skate on thin ice": "on thin ice" } })
  ]),
  wiktionary: file(`wiktionary-${withWalk}.jsonl`, wiktionary(withWalk)),
  subtitles: file("en_50k.txt", ["eat 5000", "ate 3000", "walk 2000", "may 4000", "selfie 900"])
})
const jmdictFile = file("JMdict.xml", [jmdict])

const TestLayer = Dictionary.layer.pipe(Layer.provideMerge(DatabaseMemory))

const kotoriEnglish: EntryRecord = {
  id: EntryId.make("kotori:delulu"),
  language: "en",
  source: "kotori",
  headword: "delulu",
  reading: "",
  common: false,
  priority: 10,
  forms: [
    { kind: "spelling", text: "delulu", common: false, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [
    {
      glosses: [{ text: "妄想的な", type: null }],
      pos: ["adj"],
      misc: ["sl"],
      fields: [],
      dialects: [],
      info: [],
      stagk: [],
      stagr: [],
      xrefs: [],
      antonyms: [],
      origins: [],
      wasei: false
    }
  ]
}

layer(TestLayer)("EnglishDictionary.importFiles", (it) => {
  it.effect("assigns deterministic case-preserving en:<headword> IDs and keeps twins distinct", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      const result = yield* EnglishDictionary.importFiles({ files: files(true), jmdict: jmdictFile })
      assert.deepStrictEqual(result, { removed: 0, entries: 7, curated: 2, wiktionary: 4, jmdict: 1 })

      const eat = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:eat")))
      assert.strictEqual(eat.headword, "eat")
      const onThinIce = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:on thin ice")))
      assert.strictEqual(onThinIce.headword, "on thin ice")

      // Case-preserving twins have distinct IDs and both are discoverable from lowercase search.
      const lowerMay = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:may")))
      const upperMay = Option.getOrThrow(yield* dictionary.entry(EntryId.make("en:May")))
      assert.strictEqual(lowerMay.senses[0]?.glosses[0], "～かもしれない")
      assert.strictEqual(upperMay.senses[0]?.glosses[0], "5月")
      const maySearch = yield* dictionary.search("may", "en", 10)
      assert.includeMembers(
        maySearch.entries.map((e) => e.id),
        [EntryId.make("en:may"), EntryId.make("en:May")]
      )

      // Inflections ("ate") resolve to "en:eat".
      const ateSearch = yield* dictionary.search("ate", "en", 10)
      assert.strictEqual(ateSearch.entries[0]?.id, EntryId.make("en:eat"))
      assert.deepStrictEqual(ateSearch.entries[0]?.inflection, ["past"])
    })
  )

  it.effect("replaces only external en: rows on complete re-import while leaving all kotori: states untouched", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const kotoriUnreviewed = EntryId.make("kotori:unreviewed-en")
      const kotoriDiscarded = EntryId.make("kotori:discarded-en")
      const kotoriMerged = EntryId.make("kotori:merged-en")

      yield* insertEntries(db, [kotoriEnglish])
      yield* insertEntries(
        db,
        [
          { ...kotoriEnglish, id: kotoriUnreviewed, headword: "rizz" },
          { ...kotoriEnglish, id: kotoriDiscarded, headword: "bogus" },
          { ...kotoriEnglish, id: kotoriMerged, headword: "eat-dup" }
        ],
        { reviewState: "unreviewed" }
      )
      yield* discardEntry(db, kotoriDiscarded, "rejected")
      yield* mergeEntry(db, kotoriMerged, EntryId.make("en:eat"))

      // A partial import never removes anything.
      assert.strictEqual(
        (yield* EnglishDictionary.importFiles({ files: files(false), jmdict: jmdictFile, limit: 1 })).removed,
        0
      )
      assert.isTrue(Option.isSome(yield* dictionary.entry(EntryId.make("en:walk"))))

      // Complete re-import removes stale external "en:walk" but keeps all kotori: states untouched.
      const result = yield* EnglishDictionary.importFiles({ files: files(false), jmdict: jmdictFile })
      assert.strictEqual(result.removed, 1)
      assert.isTrue(Option.isNone(yield* dictionary.entry(EntryId.make("en:walk"))))
      assert.isTrue(Option.isSome(yield* dictionary.entry(EntryId.make("en:eat"))))
      assert.strictEqual(
        Option.getOrThrow(yield* dictionary.entry(EntryId.make("kotori:delulu"))).reviewState,
        "approved"
      )
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(kotoriUnreviewed)).reviewState, "unreviewed")
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(kotoriDiscarded)).reviewState, "discarded")
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(kotoriMerged)).id, EntryId.make("en:eat"))
    })
  )
})

// Words the reverse JMdict pass admits though the subtitles never counted them, beside common ones.
const rareJmdict = `<?xml version="1.0"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
<entry><ent_seq>2000010</ent_seq><k_ele><keb>罪人</keb></k_ele><r_ele><reb>つみびと</reb></r_ele><sense><pos>&n;</pos><gloss>sinner</gloss></sense></entry>
<entry><ent_seq>2000020</ent_seq><k_ele><keb>罪</keb></k_ele><r_ele><reb>つみ</reb></r_ele><sense><pos>&n;</pos><gloss>sins</gloss></sense></entry>
<entry><ent_seq>2000030</ent_seq><k_ele><keb>シノロジー</keb></k_ele><r_ele><reb>シノロジー</reb></r_ele><sense><pos>&n;</pos><gloss>Sinology</gloss></sense></entry>
<entry><ent_seq>2000040</ent_seq><k_ele><keb>行進者</keb></k_ele><r_ele><reb>こうしんしゃ</reb></r_ele><sense><pos>&n;</pos><gloss>marcher</gloss></sense></entry>
<entry><ent_seq>2000050</ent_seq><k_ele><keb>離散</keb></k_ele><r_ele><reb>りさん</reb></r_ele><sense><pos>&n;</pos><gloss>diaspora</gloss></sense></entry>
</JMdict>`

const rareFiles = {
  wiktionary: file("wiktionary-rare.jsonl", [
    line("sin", "noun", ["罪。"]),
    line("march", "verb", ["行進する。"]),
    line("March", "noun", ["3月。"])
  ]),
  subtitles: file("en_50k-rare.txt", ["sin 3000", "march 1500"])
}

layer(TestLayer)("EnglishDictionary.importFiles with words the subtitles never counted", (it) => {
  it.effect("admits them, ranked below the common words they resemble", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      yield* EnglishDictionary.importFiles({ files: rareFiles, jmdict: file("JMdict-rare.xml", [rareJmdict]) })
      const headwords = (query: string) =>
        Effect.map(dictionary.search(query, "en", 10), (result) => result.entries.map((entry) => entry.headword))

      assert.strictEqual((yield* headwords("diaspora"))[0], "diaspora")
      // The words people use lead, however many rare ones share their letters.
      const sin = yield* headwords("sin")
      assert.strictEqual(sin[0], "sin")
      assert.includeMembers(sin, ["sinner", "Sinology"])
      const march = yield* headwords("march")
      assert.deepStrictEqual(march.slice(0, 2), ["march", "March"])
      assert.includeMembers(march, ["marcher"])
      // An inflection JMdict glosses is a form of its word, not a word of its own.
      const sins = yield* dictionary.search("sins", "en", 10)
      assert.deepStrictEqual(
        sins.entries.map((entry) => [entry.headword, entry.inflection]),
        [["sin", ["plural"]]]
      )
    })
  )
})

// Saved notes outlive the words they were saved on.
const U2 = UserId.make("00000000-0000-4000-8000-000000000002")
const noteFiles = (name: string, wiktionaryLines: ReadonlyArray<string>) => ({
  wiktionary: file(`wiktionary-${name}.jsonl`, wiktionaryLines),
  subtitles: file(`en_50k-${name}.txt`, ["spartan 500", "walk 2000"])
})
const noJmdict = file("JMdict-empty.xml", ["<JMdict></JMdict>"])

layer(TestLayer)("EnglishDictionary.importFiles with saved notes", (it) => {
  it.effect("moves notes on a word folded into its case twin to the twin, keeping one per learner", () =>
    Effect.gen(function* () {
      const db = yield* Database
      // First the twins mean different things, so each is an entry of its own.
      const apart = noteFiles("apart", [line("spartan", "adj", ["質素な"]), line("Spartan", "adj", ["スパルタの"])])
      yield* EnglishDictionary.importFiles({ files: apart, jmdict: noJmdict })
      yield* ensureUser(db, learner)
      yield* ensureUser(db, { ...learner, id: U2 })
      const one = scopedToUser(db, U1)
      const two = scopedToUser(db, U2)
      const capital = EntryId.make("en:Spartan")
      const lower = EntryId.make("en:spartan")
      yield* insertNote(one, { id: NoteId.make("00000000-0000-4000-8000-0000000000a1"), entryId: capital })
      yield* insertNote(two, { id: NoteId.make("00000000-0000-4000-8000-0000000000a2"), entryId: capital })
      yield* insertNote(two, { id: NoteId.make("00000000-0000-4000-8000-0000000000a3"), entryId: lower })

      // Then they gloss alike and fold into one entry, "spartan", spelled "Spartan" too.
      const together = noteFiles("together", [line("spartan", "adj", ["質素な"]), line("Spartan", "adj", ["質素な"])])
      const result = yield* EnglishDictionary.importFiles({ files: together, jmdict: noJmdict })
      assert.strictEqual(result.removed, 1)

      const dictionary = yield* Dictionary
      assert.isTrue(Option.isNone(yield* dictionary.entry(capital)))
      assert.deepStrictEqual(
        (yield* allNotes(one)).map((note) => note.entryId),
        [lower]
      )
      // The learner who saved both keeps the word once.
      assert.deepStrictEqual(
        (yield* allNotes(two)).map((note) => [note.id, note.entryId]),
        [[NoteId.make("00000000-0000-4000-8000-0000000000a3"), lower]]
      )
    })
  )
})

layer(TestLayer)("EnglishDictionary.importFiles with a note on a word the sources drop", (it) => {
  it.effect("refuses to delete a word a note is saved on, naming the words and their notes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const withWalk = noteFiles("walk", [line("eat", "verb", ["食べる。"]), line("walk", "verb", ["歩く。"])])
      yield* EnglishDictionary.importFiles({ files: withWalk, jmdict: noJmdict })
      yield* ensureUser(db, learner)
      const walk = EntryId.make("en:walk")
      yield* insertNote(scopedToUser(db, U1), {
        id: NoteId.make("00000000-0000-4000-8000-0000000000b1"),
        entryId: walk
      })

      const withoutWalk = noteFiles("no-walk", [line("eat", "verb", ["食べる。"]), line("run", "verb", ["走る。"])])
      const error = yield* Effect.flip(EnglishDictionary.importFiles({ files: withoutWalk, jmdict: noJmdict }))
      assert.instanceOf(error, NotedEntriesWouldBeDeleted)
      assert.deepStrictEqual(error instanceof NotedEntriesWouldBeDeleted ? error.entries : [], [
        { entryId: walk, notes: 1 }
      ])
      assert.include(error.message, "en:walk (1 note)")
      assert.include(error.message, "Nothing was written")

      // Nothing was written: the word and its note are still there, and the new word is not.
      const dictionary = yield* Dictionary
      assert.isTrue(Option.isSome(yield* dictionary.entry(walk)))
      assert.isTrue(Option.isNone(yield* dictionary.entry(EntryId.make("en:run"))))
      assert.lengthOf(yield* allNotes(scopedToUser(db, U1)), 1)
    })
  )
})

layer(TestLayer)("EnglishDictionary.importFiles with a note on a word now written in another case", (it) => {
  it.effect("moves the note to the one word spelled alike but for case", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* EnglishDictionary.importFiles({
        files: noteFiles("ipod", [line("ipod", "noun", ["アイポッド"])]),
        jmdict: noJmdict
      })
      yield* ensureUser(db, learner)
      const one = scopedToUser(db, U1)
      yield* insertNote(one, {
        id: NoteId.make("00000000-0000-4000-8000-0000000000c1"),
        entryId: EntryId.make("en:ipod")
      })

      const result = yield* EnglishDictionary.importFiles({
        files: noteFiles("iPod", [line("iPod", "noun", ["アイポッド"])]),
        jmdict: noJmdict
      })
      assert.strictEqual(result.removed, 1)
      assert.deepStrictEqual(
        (yield* allNotes(one)).map((note) => note.entryId),
        [EntryId.make("en:iPod")]
      )
    })
  )
})

layer(TestLayer)("EnglishDictionary.importFiles with a note on a word now written in several cases", (it) => {
  it.effect("refuses, as no one word is the noted one", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* EnglishDictionary.importFiles({
        files: noteFiles("ev", [line("ev", "noun", ["電気自動車"])]),
        jmdict: noJmdict
      })
      yield* ensureUser(db, learner)
      const ev = EntryId.make("en:ev")
      yield* insertNote(scopedToUser(db, U1), { id: NoteId.make("00000000-0000-4000-8000-0000000000d1"), entryId: ev })

      const twoCases = noteFiles("EV-eV", [line("EV", "noun", ["電気自動車"]), line("eV", "noun", ["電子ボルト"])])
      const error = yield* Effect.flip(EnglishDictionary.importFiles({ files: twoCases, jmdict: noJmdict }))
      assert.instanceOf(error, NotedEntriesWouldBeDeleted)
      assert.include(error.message, "en:ev (1 note)")
      assert.lengthOf(yield* allNotes(scopedToUser(db, U1)), 1)
    })
  )
})
