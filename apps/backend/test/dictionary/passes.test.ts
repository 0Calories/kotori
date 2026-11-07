import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Jev, PitfallWriter, type WordPitfalls } from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { labels, loanLinks, pitfalls } from "@kotori/db"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Effect, Layer, Logger } from "effect"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { insertEntries, linkLoans, saveKotoriPitfalls } from "../../src/features/dictionary/queries.ts"
import { loanLinkFor } from "../../src/features/dictionary/usage.ts"
import {
  applyArtifacts,
  applyFormLabels,
  applyLoanVerdicts,
  applyPitfalls
} from "../../src/features/dictionary/passes/apply.ts"
import {
  FormLine,
  LICENCE,
  LoanLine,
  parseArtifact,
  PitfallLine,
  readArtifact,
  serializeArtifact
} from "../../src/features/dictionary/passes/artifacts.ts"
import {
  formCandidates,
  loanCandidateWords,
  pitfallCandidates
} from "../../src/features/dictionary/passes/candidates.ts"
import { judgeFormPass, judgePitfallPass } from "../../src/features/dictionary/passes/judge.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { kana, kanji, sense, spelling } from "../fixtures.ts"

// The offline passes against PGlite: which words they pick, what `kotori judge` writes, and how
// the import fills only empty cells, idempotently, from small artifact files.

const directory = mkdtempSync(join(tmpdir(), "passes-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const kangamiru = EntryId.make(1215170)
const kuu = EntryId.make(1592100)
const meshiagaru = EntryId.make(1346370)
const approved = EntryId.make(200_000_001)
const advisu = EntryId.make(1015880)
const mansion = EntryId.make(1079450)
const adviceEn = EntryId.make(100_000_010)
const mansionEn = EntryId.make(100_000_011)

const ja = (id: EntryId, headword: string, reading: string, senses: EntryRecord["senses"], priority = 50) => ({
  id,
  language: "ja" as const,
  dictionary: "jmdict" as const,
  headword,
  reading,
  common: true,
  priority,
  forms: [kanji(headword), kana(reading)],
  senses
})

const en = (id: EntryId, headword: string, glosses: Array<string>) => ({
  id,
  language: "en" as const,
  dictionary: "enwiktionary" as const,
  headword,
  reading: "",
  common: true,
  priority: 40,
  forms: [spelling(headword, true)],
  senses: [sense(glosses, { pos: ["n"] })]
})

const words: Array<EntryRecord> = [
  ja(kangamiru, "鑑みる", "かんがみる", [sense(["to take into account", "to bear in mind"])], 90),
  ja(kuu, "食う", "くう", [sense(["to eat"], { misc: ["male"] }), sense(["to bite"]), sense(["to make a living"])], 80),
  ja(meshiagaru, "召し上がる", "めしあがる", [sense(["to eat", "to drink"], { misc: ["hon"] })], 70),
  { ...ja(approved, "ぴえん", "ぴえん", [sense(["boo-hoo"])], 99), dictionary: "kotori" as const },
  ja(advisu, "アドバイス", "アドバイス", [sense(["advice"], { pos: ["n"] })], 60),
  ja(mansion, "マンション", "マンション", [sense(["condominium"], { pos: ["n"], sources: ["mansion"] })], 55),
  en(adviceEn, "advice", ["助言"]),
  en(mansionEn, "mansion", ["豪邸"])
]

/** A Jev that says yes to formal wording only for 鑑みる, and that loans keep their meaning. */
const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (_state, questions) =>
      Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([name, question]) => {
            const asked = JSON.stringify(question.instructions)
            if (question.type === "noul") return [name, { type: "noul", noul: asked.includes("鑑みる") ? 0.9 : 0.1 }]
            return [
              name,
              { type: "choice", choice: "same", confidence: 1, probabilities: { same: 0.9, divergent: 0.1 } }
            ]
          })
        ),
        usage: { input_tokens: 10, output_tokens: 0 }
      } as never)
  })
)

/** A pitfall writer that warns about 食う's eating sense only. */
const FakeWriter = Layer.succeed(
  PitfallWriter,
  PitfallWriter.of({
    model: "claude-test",
    write: (batch) =>
      Effect.succeed(
        batch.map((word): WordPitfalls => ({
          missing: false,
          dropped: [],
          pitfalls:
            word.headword === "食う"
              ? [{ kind: "rude_upward", text: "Rough; say 食べる upward.", sense: 0, about: "召し上がる" }]
              : []
        }))
      )
  })
)

const TestLayer = Layer.mergeAll(DatabaseMemory, NodeFileSystem.layer, NodePath.layer, FakeJev, FakeWriter)

const options = { limit: 100, dryRun: false, concurrency: 1, commonOnly: true, restart: false }

const formOf = (entryId: EntryId) =>
  Effect.gen(function* () {
    const db = yield* Database
    return yield* db
      .select({ sense: labels.sense, source: labels.source })
      .from(labels)
      .where(and(eq(labels.entryId, entryId), eq(labels.code, "form")))
      .orderBy(asc(labels.sense))
  })

const pitfallsOf = (entryId: EntryId) =>
  Effect.gen(function* () {
    const db = yield* Database
    return yield* db
      .select({
        rank: pitfalls.rank,
        sense: pitfalls.sense,
        text: pitfalls.text,
        source: pitfalls.source,
        about: pitfalls.aboutEntryId
      })
      .from(pitfalls)
      .where(eq(pitfalls.entryId, entryId))
      .orderBy(asc(pitfalls.rank))
  })

layer(TestLayer)("offline passes", (it) => {
  it.effect("picks unlabelled senses of dictionary words, never approved words", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, words)
      const picked = yield* formCandidates(db, { commonOnly: true, judged: new Set(), limit: 10 })
      // 食う's eating sense is labelled `male`; 召し上がる's only sense `hon`; ぴえん is approved.
      assert.deepStrictEqual(
        picked.map((candidate) => [candidate.word.headword, candidate.senses]),
        [
          ["鑑みる", [0]],
          ["食う", [1, 2]],
          ["アドバイス", [0]],
          ["マンション", [0]]
        ]
      )
      const after = yield* formCandidates(db, { commonOnly: true, judged: new Set([kangamiru]), limit: 1 })
      assert.deepStrictEqual(
        after.map((candidate) => candidate.word.headword),
        ["食う"]
      )
      const shown = yield* pitfallCandidates(db, { language: "ja", commonOnly: true, judged: new Set(), limit: 10 })
      assert.deepStrictEqual(shown.find((candidate) => candidate.entryId === kuu)?.word.senses[0]?.labels, ["male"])
      assert.isUndefined(shown.find((candidate) => candidate.entryId === approved))
    })
  )

  it.effect("finds English words' loan candidates by gloss and by JMdict source", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* linkLoans(db)
      const found = yield* loanCandidateWords(db, { commonOnly: true, judged: new Set(), limit: 10 }, 3)
      assert.deepStrictEqual(
        found.map((word) => [word.english, word.candidates.map((candidate) => [candidate.katakana, candidate.by])]),
        [
          ["advice", [["アドバイス", "gloss"]]],
          ["mansion", [["マンション", "source"]]]
        ]
      )
    })
  )

  it.effect("judges into the artifact, resumes, and refuses another prompt version's file", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const file = join(directory, "ja-form.jsonl")
      const dry = yield* judgeFormPass(db, { ...options, dryRun: true, file })
      assert.strictEqual(dry.requests, 1)
      assert.throws(() => readFileSync(file))

      const run = yield* judgeFormPass(db, { ...options, file })
      assert.strictEqual(run.judged, 4)
      const written = parseArtifact(readFileSync(file, "utf8"), FormLine)!
      assert.strictEqual(written.header.model, "jev-test")
      assert.deepStrictEqual(
        written.lines.find((line) => line.entryId === kangamiru),
        {
          entryId: kangamiru,
          headword: "鑑みる",
          form: [{ gloss: "to take into account", p: 0.9 }]
        }
      )
      assert.deepStrictEqual(written.lines.find((line) => line.entryId === kuu)?.form, [])

      const again = yield* judgeFormPass(db, { ...options, file })
      assert.strictEqual(again.candidates, 0)

      writeFileSync(file, readFileSync(file, "utf8").replace('"promptVersion":1', '"promptVersion":0'))
      const refused = yield* judgeFormPass(db, { ...options, file }).pipe(Effect.flip)
      assert.include(String(refused), "--restart")
    })
  )

  it.effect("writes pitfalls naming their sense by gloss", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const file = join(directory, "ja.jsonl")
      yield* judgePitfallPass(db, "ja", { ...options, file })
      const written = parseArtifact(readFileSync(file, "utf8"), PitfallLine)!
      assert.deepStrictEqual(written.lines.find((line) => line.entryId === kuu)?.pitfalls, [
        { kind: "rude_upward", text: "Rough; say 食べる upward.", sense: "to eat", about: "召し上がる" }
      ])
    })
  )

  it.effect("fills form labels on empty senses only, idempotently", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const lines = [
        { entryId: kangamiru, headword: "鑑みる", form: [{ gloss: "to take into account", p: 0.9 }] },
        // A sense the dictionary labels already, a gloss no sense has, a word that changed, an approved word.
        {
          entryId: kuu,
          headword: "食う",
          form: [
            { gloss: "to eat", p: 0.8 },
            { gloss: "to fly", p: 0.8 }
          ]
        },
        { entryId: meshiagaru, headword: "召しあがる", form: [{ gloss: "to eat", p: 0.8 }] },
        { entryId: approved, headword: "ぴえん", form: [{ gloss: "boo-hoo", p: 0.8 }] }
      ]
      assert.strictEqual((yield* applyFormLabels(db, lines)).written, 1)
      assert.strictEqual((yield* applyFormLabels(db, lines)).written, 1)
      assert.deepStrictEqual(yield* formOf(kangamiru), [{ sense: 0, source: "kotori" }])
      assert.deepStrictEqual(yield* formOf(kuu), [])
      assert.deepStrictEqual(yield* formOf(approved), [])

      // The file decides: a word judged plain again loses Kotori's label.
      yield* applyFormLabels(db, [{ entryId: kangamiru, headword: "鑑みる", form: [] }])
      assert.deepStrictEqual(yield* formOf(kangamiru), [])
    })
  )

  it.effect("fills pitfalls into the free ranks, linking the word they name, idempotently", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db
        .insert(pitfalls)
        .values({ entryId: kuu, sense: null, rank: 1, kind: "confusable", text: "A learner's.", source: "user" })
      const line = {
        entryId: kuu,
        headword: "食う",
        pitfalls: [
          { kind: "rude_upward" as const, text: "Rough upward.", sense: "to eat", about: "召し上がる" },
          { kind: "collocation" as const, text: "Insects 食う.", sense: "to bite", about: null },
          { kind: "tone" as const, text: "Gone sense.", sense: "to fly", about: null },
          { kind: "set_phrase" as const, text: "Over the cap.", sense: null, about: null }
        ]
      }
      const approvedLine = {
        entryId: approved,
        headword: "ぴえん",
        pitfalls: [{ kind: "tone" as const, text: "x", sense: null, about: null }]
      }
      assert.strictEqual((yield* applyPitfalls(db, "ja", [line, approvedLine])).written, 2)
      assert.strictEqual((yield* applyPitfalls(db, "ja", [line, approvedLine])).written, 2)
      assert.deepStrictEqual(yield* pitfallsOf(kuu), [
        { rank: 1, sense: null, text: "A learner's.", source: "user", about: null },
        { rank: 2, sense: 0, text: "Rough upward.", source: "kotori", about: meshiagaru },
        { rank: 3, sense: 1, text: "Insects 食う.", source: "kotori", about: null }
      ])
      assert.deepStrictEqual(yield* pitfallsOf(approved), [])
    })
  )

  it.effect("sets loan verdicts as Kotori's, adding pairs JMdict doesn't name as Kotori's, idempotently", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const lines = [
        {
          english: "mansion",
          englishId: mansionEn,
          katakana: "マンション",
          katakanaId: mansion,
          meaning: "divergent" as const,
          p: 0.99
        },
        {
          english: "advice",
          englishId: adviceEn,
          katakana: "アドバイス",
          katakanaId: advisu,
          meaning: "same" as const,
          p: 0.86
        },
        { english: "walk", englishId: 1, katakana: null, katakanaId: null, meaning: null, p: null }
      ]
      assert.deepStrictEqual(yield* applyLoanVerdicts(db, lines), { written: 2, removed: 0 })
      assert.deepStrictEqual(yield* applyLoanVerdicts(db, lines), { written: 0, removed: 0 })
      const rows = yield* db
        .select({
          katakana: loanLinks.katakana,
          english: loanLinks.english,
          katakanaId: loanLinks.katakanaEntryId,
          englishId: loanLinks.englishEntryId,
          meaning: loanLinks.meaning,
          source: loanLinks.source,
          meaningSource: loanLinks.meaningSource
        })
        .from(loanLinks)
        .orderBy(asc(loanLinks.katakana))
      assert.deepStrictEqual(rows, [
        {
          katakana: "アドバイス",
          english: "advice",
          katakanaId: advisu,
          englishId: adviceEn,
          meaning: "same",
          source: "kotori",
          meaningSource: "kotori"
        },
        {
          katakana: "マンション",
          english: "mansion",
          katakanaId: mansion,
          englishId: mansionEn,
          meaning: "divergent",
          // JMdict names the pair; Kotori judged its meaning.
          source: "jmdict",
          meaningSource: "kotori"
        }
      ])
      // A meaning another source judged is never overwritten.
      yield* db.update(loanLinks).set({ meaningSource: "user" }).where(eq(loanLinks.katakana, "アドバイス"))
      yield* applyLoanVerdicts(db, [lines[0]!, { ...lines[1]!, meaning: "divergent" }])
      const [kept] = yield* db
        .select({ meaning: loanLinks.meaning })
        .from(loanLinks)
        .where(eq(loanLinks.katakana, "アドバイス"))
      assert.strictEqual(kept?.meaning, "same")
      // A word with a verdict is no longer a candidate.
      const open = yield* loanCandidateWords(db, { commonOnly: true, judged: new Set(), limit: 10 }, 3)
      assert.deepStrictEqual(open, [])
    })
  )

  it.effect("keeps Kotori's verdict on a pair JMdict names through a reseed, and a changed file replaces it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const tension = EntryId.make(1083030)
      const tensionEn = EntryId.make(100_000_020)
      const named = (sources: Array<string>) =>
        ja(tension, "テンション", "テンション", [sense(["excitement"], { pos: ["n"], sources })], 52)
      yield* insertEntries(db, [named(["tension"]), en(tensionEn, "tension", ["緊張"])])
      yield* linkLoans(db)
      const line = {
        english: "tension",
        englishId: tensionEn,
        katakana: "テンション",
        katakanaId: tension,
        meaning: "divergent" as const,
        p: 0.97
      }
      // Apply, reseed (JMdict's links are rebuilt first), then apply a corrected file.
      yield* applyLoanVerdicts(db, [line])
      yield* linkLoans(db)
      yield* applyLoanVerdicts(db, [{ ...line, meaning: "same" }])
      const corrected = yield* loanLinkFor(db, tensionEn)
      assert.strictEqual(corrected?.meaning, "same")
      // JMdict still names the pair, and the verdict is still Kotori's.
      yield* linkLoans(db)
      assert.deepStrictEqual([corrected?.source, corrected?.meaningSource], ["jmdict", "kotori"])
      assert.deepStrictEqual(yield* loanLinkFor(db, tensionEn), corrected)

      // A pair JMdict stops naming goes, whoever judged its meaning.
      yield* applyLoanVerdicts(db, [line])
      yield* insertEntries(db, [named([])])
      yield* linkLoans(db)
      assert.isNull(yield* loanLinkFor(db, tensionEn))
    })
  )

  it.effect("sets no loan verdict on an approved Ask Kotori word, at either end", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const selfie = EntryId.make(1960010)
      const selfieEn = EntryId.make(300_000_001)
      const emoi = EntryId.make(200_000_002)
      const emotionalEn = EntryId.make(100_000_021)
      yield* insertEntries(db, [
        ja(selfie, "セルフィー", "セルフィー", [sense(["selfie"], { pos: ["n"] })], 30),
        { ...en(selfieEn, "selfie", ["自撮り"]), dictionary: "kotori" as const },
        {
          ...ja(emoi, "エモい", "エモい", [sense(["emotional"], { pos: ["adj-i"] })], 30),
          dictionary: "kotori" as const
        },
        en(emotionalEn, "emotional", ["感情的"])
      ])
      const lines = [
        {
          english: "selfie",
          englishId: selfieEn,
          katakana: "セルフィー",
          katakanaId: selfie,
          meaning: "same" as const,
          p: 0.9
        },
        {
          english: "emotional",
          englishId: emotionalEn,
          katakana: "エモい",
          katakanaId: emoi,
          meaning: "divergent" as const,
          p: 0.9
        }
      ]
      yield* applyLoanVerdicts(db, lines)
      const rows = yield* db
        .select({ katakana: loanLinks.katakana })
        .from(loanLinks)
        .where(inArray(loanLinks.katakana, ["セルフィー", "エモい"]))
      assert.deepStrictEqual(rows, [])
    })
  )

  it.effect("removes what a trimmed or deleted file added, and leaves approved words' own alone", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const handle = EntryId.make(1096050)
      const handleEn = EntryId.make(100_000_022)
      const game = EntryId.make(1052040)
      const gameEn = EntryId.make(100_000_023)
      yield* insertEntries(db, [
        ja(handle, "ハンドル", "ハンドル", [sense(["steering wheel"], { pos: ["n"], sources: ["handle"] })], 45),
        en(handleEn, "handle", ["取っ手"]),
        ja(game, "ゲーム", "ゲーム", [sense(["game"], { pos: ["n"] })], 65),
        en(gameEn, "game", ["遊び"])
      ])
      yield* linkLoans(db)
      // An approved word's label and pitfall are its approved file's, not a pass's.
      yield* db.insert(labels).values({ entryId: approved, sense: 0, code: "form", source: "kotori" })
      yield* saveKotoriPitfalls(db, approved, "ja", [
        { kind: "tone", text: "Playful, never real grief.", sense: null, about: null }
      ])

      const form = {
        kangamiru: { entryId: kangamiru, headword: "鑑みる", form: [{ gloss: "to take into account", p: 0.9 }] },
        kuu: { entryId: kuu, headword: "食う", form: [{ gloss: "to bite", p: 0.8 }] }
      }
      const pitfall = {
        kangamiru: {
          entryId: kangamiru,
          headword: "鑑みる",
          pitfalls: [{ kind: "set_phrase" as const, text: "Mostly 〜に鑑み.", sense: null, about: null }]
        },
        kuu: {
          entryId: kuu,
          headword: "食う",
          pitfalls: [{ kind: "rude_upward" as const, text: "Rough upward.", sense: "to eat", about: null }]
        }
      }
      const loan = {
        handle: {
          english: "handle",
          englishId: handleEn,
          katakana: "ハンドル",
          katakanaId: handle,
          meaning: "divergent" as const,
          p: 0.95
        },
        game: {
          english: "game",
          englishId: gameEn,
          katakana: "ゲーム",
          katakanaId: game,
          meaning: "same" as const,
          p: 0.9
        }
      }
      yield* applyFormLabels(db, [form.kangamiru, form.kuu])
      yield* applyPitfalls(db, "ja", [pitfall.kangamiru, pitfall.kuu])
      yield* applyLoanVerdicts(db, [loan.handle, loan.game])
      assert.deepStrictEqual(yield* formOf(kuu), [{ sense: 1, source: "kotori" }])

      const pair = (katakana: string) =>
        db
          .select({ meaning: loanLinks.meaning, source: loanLinks.source })
          .from(loanLinks)
          .where(eq(loanLinks.katakana, katakana))
      const kotoriPitfalls = (entryId: EntryId) =>
        Effect.map(pitfallsOf(entryId), (rows) => rows.filter((row) => row.source === "kotori").map((row) => row.text))
      const header = (pass: string) => ({ pass, model: "test", promptVersion: 1, licence: LICENCE })
      const files = {
        "ja-form": join(directory, "trimmed", "ja-form.jsonl"),
        "pitfalls-ja": join(directory, "trimmed", "pitfalls-ja.jsonl"),
        "pitfalls-en": join(directory, "trimmed", "pitfalls-en.jsonl"),
        loans: join(directory, "trimmed", "loans.jsonl")
      }
      mkdirSync(join(directory, "trimmed"))
      writeFileSync(
        files["ja-form"],
        serializeArtifact(header("ja-form"), [form.kangamiru], (line) => line.entryId)
      )
      writeFileSync(
        files["pitfalls-ja"],
        serializeArtifact(header("pitfalls-ja"), [pitfall.kangamiru], (line) => line.entryId)
      )
      writeFileSync(
        files.loans,
        serializeArtifact(header("loans"), [loan.handle], (line) => line.englishId)
      )

      // Trimmed: the words the files no longer name lose what the passes gave them.
      yield* applyArtifacts(db, files)
      assert.deepStrictEqual(yield* formOf(kuu), [])
      assert.deepStrictEqual(yield* formOf(kangamiru), [{ sense: 0, source: "kotori" }])
      assert.deepStrictEqual(yield* kotoriPitfalls(kuu), [])
      assert.deepStrictEqual(yield* kotoriPitfalls(kangamiru), ["Mostly 〜に鑑み."])
      assert.deepStrictEqual(yield* pair("ゲーム"), [])
      assert.deepStrictEqual(yield* pair("ハンドル"), [{ meaning: "divergent", source: "jmdict" }])

      // Deleted: nothing the passes gave is left; the pair JMdict names stays, without a verdict.
      for (const file of Object.values(files)) rmSync(file, { force: true })
      yield* applyArtifacts(db, files)
      assert.deepStrictEqual(yield* formOf(kangamiru), [])
      assert.deepStrictEqual(yield* kotoriPitfalls(kangamiru), [])
      assert.deepStrictEqual(yield* pair("ハンドル"), [{ meaning: null, source: "jmdict" }])
      assert.deepStrictEqual(
        (yield* pitfallsOf(kuu)).map((row) => row.source),
        ["user"]
      )
      assert.deepStrictEqual(yield* formOf(approved), [{ sense: 0, source: "kotori" }])
      assert.deepStrictEqual(yield* kotoriPitfalls(approved), ["Playful, never real grief."])
    })
  )

  it.effect("reports lines that don't decode, with their line numbers", () =>
    Effect.gen(function* () {
      const header = { pass: "ja-form", model: "jev-test", promptVersion: 1, licence: LICENCE }
      const text = [
        JSON.stringify(header),
        JSON.stringify({ entryId: kangamiru, headword: "鑑みる", form: [] }),
        "{not json",
        JSON.stringify({ entryId: "x", headword: "食う", form: [] }),
        "",
        JSON.stringify({ entryId: kuu, headword: "食う", form: [] })
      ].join("\n")
      const parsed = parseArtifact(text, FormLine)!
      assert.deepStrictEqual(
        parsed.lines.map((line) => line.entryId),
        [kangamiru, kuu]
      )
      assert.deepStrictEqual(parsed.skipped, [3, 4])

      const file = join(directory, "mixed.jsonl")
      writeFileSync(file, text)
      const warnings: Array<string> = []
      const capture = Logger.layer([Logger.make(({ message }) => void warnings.push(String(message)))])
      const read = yield* readArtifact(file, FormLine, "ja-form").pipe(Effect.provide(capture))
      assert.strictEqual(read?.lines.length, 2)
      assert.deepStrictEqual(warnings, [`${file}: skipped 2 lines that don't decode (lines 3, 4)`])
    })
  )

  it.effect("refuses a file another pass wrote", () =>
    Effect.gen(function* () {
      const file = join(directory, "form-not-loans.jsonl")
      const header = { pass: "ja-form", model: "jev-test", promptVersion: 1, licence: LICENCE }
      writeFileSync(
        file,
        serializeArtifact(header, [], (line: FormLine) => line.entryId)
      )
      const refused = yield* readArtifact(file, LoanLine, "loans").pipe(Effect.flip)
      assert.include(String(refused), "ja-form")
      // A file with no header isn't taken for an absent one.
      writeFileSync(file, "{not a header\n")
      assert.include(String(yield* readArtifact(file, FormLine, "ja-form").pipe(Effect.flip)), "no header")
    })
  )
})
