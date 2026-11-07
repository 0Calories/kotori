import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Jev, PitfallWriter, type WordPitfalls } from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { labels, loanLinks, pitfalls } from "@kotori/db"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { insertEntries, linkLoans } from "../../src/features/dictionary/queries.ts"
import { applyFormLabels, applyLoanVerdicts, applyPitfalls } from "../../src/features/dictionary/passes/apply.ts"
import { FormLine, parseArtifact, PitfallLine } from "../../src/features/dictionary/passes/artifacts.ts"
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
      assert.strictEqual(yield* applyFormLabels(db, lines), 1)
      assert.strictEqual(yield* applyFormLabels(db, lines), 1)
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
      assert.strictEqual(yield* applyPitfalls(db, "ja", [line, approvedLine]), 2)
      assert.strictEqual(yield* applyPitfalls(db, "ja", [line, approvedLine]), 2)
      assert.deepStrictEqual(yield* pitfallsOf(kuu), [
        { rank: 1, sense: null, text: "A learner's.", source: "user", about: null },
        { rank: 2, sense: 0, text: "Rough upward.", source: "kotori", about: meshiagaru },
        { rank: 3, sense: 1, text: "Insects 食う.", source: "kotori", about: null }
      ])
      assert.deepStrictEqual(yield* pitfallsOf(approved), [])
    })
  )

  it.effect("sets loan verdicts as Kotori's, adding pairs JMdict doesn't name, idempotently", () =>
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
      assert.strictEqual(yield* applyLoanVerdicts(db, lines), 2)
      assert.strictEqual(yield* applyLoanVerdicts(db, lines), 0)
      const rows = yield* db
        .select({
          katakana: loanLinks.katakana,
          english: loanLinks.english,
          katakanaId: loanLinks.katakanaEntryId,
          englishId: loanLinks.englishEntryId,
          meaning: loanLinks.meaning,
          source: loanLinks.source
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
          source: "kotori"
        },
        {
          katakana: "マンション",
          english: "mansion",
          katakanaId: mansion,
          englishId: mansionEn,
          meaning: "divergent",
          source: "kotori"
        }
      ])
      // A meaning another source set is never overwritten.
      yield* db.update(loanLinks).set({ source: "jmdict" }).where(eq(loanLinks.katakana, "アドバイス"))
      yield* applyLoanVerdicts(db, [{ ...lines[1]!, meaning: "divergent" }])
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
})
