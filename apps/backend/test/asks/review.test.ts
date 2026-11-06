import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { type DraftEntry, FIRST_APPROVED_JA_ID, labels, patterns, pitfalls, proposals } from "@kotori/db"
import { asc, eq } from "drizzle-orm"
import { Effect, FileSystem, Layer } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { approveProposal, discardProposal, draftToRecord, parseApprovedJa } from "../../src/features/asks/review.ts"
import { parseApproved } from "../../src/features/dictionary/import/eiwa/approved.ts"
import { findForms, getEntries, insertEntries } from "../../src/features/dictionary/queries.ts"
import { jobStatusFor } from "../../src/features/enrichment/jobs.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, U1 } from "../fixtures.ts"

const directory = mkdtempSync(join(tmpdir(), "approved-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const files = { en: join(directory, "en.jsonl"), ja: join(directory, "ja.jsonl") }

const draft: DraftEntry = {
  headword: "bussin",
  reading: "/ˈbʌsɪn/",
  spellings: ["bussin'"],
  familiarity: 4,
  senses: [
    { glosses: ["すごくおいしい"], pos: ["adj"], labels: ["sl"], patterns: ["若者のスラングです。"] },
    { glosses: ["最高"], pos: ["adj"], labels: ["sl"], patterns: [] }
  ],
  pitfalls: [
    { kind: "collocation", text: "食べ物について It's bussin. の形でよく使います。", sense: 0, about: "eat" },
    { kind: "variety", text: "主にアメリカの若者言葉です。", sense: null, about: null }
  ]
}

const jaDraft: DraftEntry = {
  headword: "蛙化現象",
  reading: "かえるかげんしょう",
  spellings: ["カエル化現象"],
  familiarity: 3,
  senses: [{ glosses: ["the ick"], pos: ["n"], labels: ["sl"], patterns: ["Young people's slang."] }],
  pitfalls: [{ kind: "set_phrase", text: "Mostly said of a crush, not a partner.", sense: 0, about: null }]
}

const propose = (
  db: Parameters<typeof approveProposal>[0],
  language: "en" | "ja",
  query: string,
  entry: DraftEntry | null
) =>
  db
    .insert(proposals)
    .values({
      language,
      query,
      status: "pending",
      draft: entry,
      linkedEntryId: null,
      reason: null,
      model: "test",
      requestedBy: U1,
      createdAt: new Date(0)
    })
    .returning()
    .pipe(
      Effect.map((rows) => rows[0]!.id),
      Effect.orDie
    )

const seeded = Effect.gen(function* () {
  const db = yield* Database
  yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
  yield* insertEntries(db, english)
})

const TestLayer = Layer.mergeAll(DatabaseMemory, NodeFileSystem.layer, NodePath.layer)

layer(TestLayer)("proposal review", (it) => {
  it.effect("approving a draft makes a real entry, queues enrichment, and persists to the approved file", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const id = yield* propose(db, "en", "bussin", draft)
      const approved = yield* approveProposal(db, id, files)
      assert.strictEqual(approved.headword, "bussin")

      // The entry is searchable by headword and spelling, with the draft's labels, patterns and
      // pitfalls as Kotori's, the pitfall linked to the word it names.
      const [match] = yield* findForms(db, ["bussin'"], "en")
      assert.strictEqual(match?.entryId, approved.entryId)
      const [entry] = yield* getEntries(db, [approved.entryId])
      assert.strictEqual(entry?.dictionary, "kotori")
      assert.deepStrictEqual(
        yield* db
          .select({ sense: labels.sense, code: labels.code, source: labels.source })
          .from(labels)
          .where(eq(labels.entryId, approved.entryId))
          .orderBy(asc(labels.sense)),
        [
          { sense: 0, code: "sl", source: "kotori" },
          { sense: 1, code: "sl", source: "kotori" }
        ]
      )
      assert.deepStrictEqual(
        yield* db
          .select({ sense: patterns.sense, text: patterns.text, source: patterns.source })
          .from(patterns)
          .where(eq(patterns.entryId, approved.entryId)),
        [{ sense: 0, text: "若者のスラングです。", source: "kotori" }]
      )
      assert.deepStrictEqual(
        yield* db
          .select({ rank: pitfalls.rank, kind: pitfalls.kind, sense: pitfalls.sense, about: pitfalls.aboutEntryId })
          .from(pitfalls)
          .where(eq(pitfalls.entryId, approved.entryId))
          .orderBy(asc(pitfalls.rank)),
        [
          { rank: 1, kind: "collocation", sense: 0, about: english[0]!.id },
          { rank: 2, kind: "variety", sense: null, about: null }
        ]
      )
      const jobs = yield* jobStatusFor(db, approved.entryId)
      assert.deepStrictEqual([...jobs.keys()].toSorted(), ["audio", "examples", "nuance"])

      // The approved file replays the entry on the next import, familiarity included.
      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.strictEqual(parsed.words[0]?.headword, "bussin")
      assert.strictEqual(parsed.words[0]?.familiarity, 4)
      assert.strictEqual(parsed.words[0]?.senses[0]?.misc.includes("sl"), true)
      assert.deepStrictEqual(parsed.words[0]?.senses[0]?.info, ["若者のスラングです。"])
      assert.deepStrictEqual(parsed.words[0]?.pitfalls, draft.pitfalls)

      // Approving twice is refused.
      const again = yield* Effect.flip(approveProposal(db, id, files))
      assert.strictEqual(again._tag, "NotPending")
    })
  )

  it.effect("an alias approval adds a spelling to the entry instead of a new one", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const id = yield* propose(db, "en", "it be like it be", {
        ...draft,
        headword: "it be like it be",
        spellings: []
      })
      const approved = yield* approveProposal(db, id, files, { aliasOf: "eat" })
      assert.strictEqual(approved.alias, "it be like it be")
      const matches = yield* findForms(db, ["it be like it be"], "en")
      assert.strictEqual(matches[0]?.entryId, approved.entryId)
      assert.strictEqual(approved.headword, "eat")

      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.deepStrictEqual(parsed.formsOf.at(-1), { text: "it be like it be", base: "eat", tags: [] })
    })
  )

  it.effect("a Japanese draft gets an id in the approved range and comes back from its file", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const id = yield* propose(db, "ja", "蛙化現象", jaDraft)
      const approved = yield* approveProposal(db, id, files)
      assert.isAtLeast(approved.entryId, FIRST_APPROVED_JA_ID + 1)
      const [entry] = yield* getEntries(db, [approved.entryId])
      // getEntries lists forms kanji first, as the dictionary does.
      assert.deepStrictEqual(
        entry?.forms.map((form) => [form.kind, form.text]),
        [
          ["kanji", "蛙化現象"],
          ["kanji", "カエル化現象"],
          ["kana", "かえるかげんしょう"]
        ]
      )

      const parsed = parseApprovedJa((yield* fs.readFileString(files.ja)).split("\n"))
      assert.strictEqual(parsed.records[0]?.id, approved.entryId)
      assert.strictEqual(parsed.records[0]?.senses[0]?.glosses[0]?.text, "the ick")
      assert.deepStrictEqual(parsed.pitfalls, [{ entryId: approved.entryId, pitfalls: jaDraft.pitfalls }])
    })
  )

  it.effect("discarding keeps the row as a negative cache", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seeded
      const id = yield* propose(db, "en", "slopword", draft)
      const discarded = yield* discardProposal(db, id, "not established usage")
      assert.strictEqual(discarded.query, "slopword")
      const again = yield* Effect.flip(discardProposal(db, id, null))
      assert.strictEqual(again._tag, "NotPending")
    })
  )

  it.effect("draftToRecord stores labels and patterns where the import reads them", () =>
    Effect.sync(() => {
      const record = draftToRecord(draft, "en", 100_900_000 as never)
      assert.deepStrictEqual(record.senses[0]?.misc, ["sl"])
      assert.deepStrictEqual(record.senses[0]?.info, ["若者のスラングです。"])
      assert.deepStrictEqual(record.senses[0]?.pos, ["adj"])
    })
  )
})
