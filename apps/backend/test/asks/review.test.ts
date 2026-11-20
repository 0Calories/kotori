import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, describe, it, layer } from "@effect/vitest"
import { type DraftEntry, EntryId, proposals } from "@kotori/db"
import { Effect, FileSystem, Layer, Option } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { approveProposal, discardProposal, draftToRecord, parseApprovedJa } from "../../src/features/asks/review.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import { parseApproved } from "../../src/features/dictionary/import/english/approved.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, U1 } from "../fixtures.ts"

const directory = mkdtempSync(join(tmpdir(), "approved-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const files = { en: join(directory, "en.jsonl"), ja: join(directory, "ja.jsonl") }

const draft: DraftEntry = {
  headword: "bussin",
  reading: "/ˈbʌsɪn/",
  spellings: ["bussin'"],
  frequency: 4,
  senses: [
    { glosses: ["すごくおいしい"], pos: ["adj"], labels: ["sl"], usagePatterns: ["若者のスラングです。"] },
    { glosses: ["最高"], pos: ["adj"], labels: ["sl"], usagePatterns: [] }
  ],
  cautions: [
    { kind: "collocation", text: "食べ物について It's bussin. の形でよく使います。", sense: 0, about: "eat" },
    { kind: "variety", text: "主にアメリカの若者言葉です。", sense: null, about: null }
  ]
}

const jaDraft: DraftEntry = {
  headword: "蛙化現象",
  reading: "かえるかげんしょう",
  spellings: ["カエル化現象"],
  frequency: 3,
  senses: [{ glosses: ["the ick"], pos: ["n"], labels: ["sl"], usagePatterns: ["Young people's slang."] }],
  cautions: [{ kind: "set_phrase", text: "Mostly said of a crush, not a partner.", sense: 0, about: null }]
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

const TestLayer = Layer.mergeAll(Dictionary.layer, NodeFileSystem.layer, NodePath.layer).pipe(
  Layer.provideMerge(DatabaseMemory)
)

layer(TestLayer)("proposal review", (it) => {
  it.effect("approving a draft makes a real kotori: entry and persists to the approved file", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const id = yield* propose(db, "en", "bussin", draft)
      const approved = yield* approveProposal(db, id, files)
      assert.strictEqual(approved.headword, "bussin")
      assert.isTrue(approved.entryId.startsWith("kotori:"))

      // The entry is searchable by headword and spelling, with the draft's labels, usage patterns,
      // cautions (linked to the word named), and frequency score.
      const found = yield* dictionary.search("bussin'", "en", 10)
      assert.strictEqual(found.entries[0]?.id, approved.entryId)
      const entry = Option.getOrThrow(yield* dictionary.entry(approved.entryId))
      assert.strictEqual(entry.source, "kotori")
      assert.deepStrictEqual(
        entry.labels.map((l) => [l.code, l.source]),
        [["sl", "kotori"]]
      )
      assert.deepStrictEqual(entry.senses[0]?.usagePatterns, [
        { text: "若者のスラングです。", source: "kotori", about: null }
      ])
      assert.deepStrictEqual(
        entry.cautions.map((c) => [c.kind, c.sense, c.about?.entryId ?? null]),
        [
          ["collocation", 0, english[0]!.id],
          ["variety", null, null]
        ]
      )
      assert.deepStrictEqual(entry.frequency, { everyday: false, spokenCount: null, score: 4 })

      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.strictEqual(parsed.words[0]?.headword, "bussin")
      assert.strictEqual(parsed.words[0]?.frequency, 4)
      assert.deepStrictEqual(parsed.words[0]?.cautions, draft.cautions)

      // Approving twice is refused.
      const again = yield* Effect.flip(approveProposal(db, id, files))
      assert.strictEqual(again._tag, "NotPending")
    })
  )

  it.effect("an alias approval adds a spelling to the entry instead of a new one", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const id = yield* propose(db, "en", "it be like it be", {
        ...draft,
        headword: "it be like it be",
        spellings: []
      })
      const approved = yield* approveProposal(db, id, files, { aliasOf: "eat" })
      assert.strictEqual(approved.alias, "it be like it be")
      const found = yield* dictionary.search("it be like it be", "en", 10)
      assert.strictEqual(found.entries[0]?.id, approved.entryId)
      assert.strictEqual(approved.headword, "eat")

      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.deepStrictEqual(parsed.formsOf.at(-1), { text: "it be like it be", base: "eat", tags: [] })
    })
  )

  it.effect("a Japanese draft gets a kotori: id and comes back from its file", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const id = yield* propose(db, "ja", "蛙化現象", jaDraft)
      const approved = yield* approveProposal(db, id, files)
      assert.isTrue(approved.entryId.startsWith("kotori:"))
      const entry = Option.getOrThrow(yield* dictionary.entry(approved.entryId))
      assert.deepStrictEqual(
        entry.forms.map((form) => [form.kind, form.text]),
        [
          ["kanji", "蛙化現象"],
          ["kana", "かえるかげんしょう"],
          ["kanji", "カエル化現象"]
        ]
      )
      assert.deepStrictEqual(entry.frequency, { everyday: false, spokenCount: null, score: 3 })

      const parsed = parseApprovedJa((yield* fs.readFileString(files.ja)).split("\n"))
      assert.strictEqual(parsed.records[0]?.id, approved.entryId)
      assert.strictEqual(parsed.records[0]?.senses[0]?.glosses[0]?.text, "the ick")
      assert.deepStrictEqual(parsed.records[0]?.frequency, { everyday: false, spokenCount: null, score: 3 })
      assert.deepStrictEqual(parsed.cautions, [{ entryId: approved.entryId, cautions: jaDraft.cautions }])
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

  it.effect("draftToRecord stores labels and usage patterns where the import reads them", () =>
    Effect.sync(() => {
      const record = draftToRecord(draft, "en", EntryId.make("kotori:test"))
      assert.deepStrictEqual(record.senses[0]?.misc, ["sl"])
      assert.deepStrictEqual(record.senses[0]?.info, ["若者のスラングです。"])
      assert.deepStrictEqual(record.senses[0]?.pos, ["adj"])
    })
  )
})

describe("approved files", () => {
  it("loads a Japanese line written before entries named their source, as an Ask Kotori word", () => {
    const id = EntryId.make("kotori:approved-1")
    const { source: _, ...old } = draftToRecord(jaDraft, "ja", id)
    const parsed = parseApprovedJa([JSON.stringify({ entry: old })])
    assert.deepStrictEqual(parsed.skipped, [])
    assert.strictEqual(parsed.records[0]?.id, id)
    assert.strictEqual(parsed.records[0]?.source, "kotori")
  })

  it("names the lines it can't read, by line number, instead of losing them silently", () => {
    const line = JSON.stringify({ entry: draftToRecord(jaDraft, "ja", EntryId.make("kotori:approved-1")) })
    const ja = parseApprovedJa([line, "", "{not json", JSON.stringify({ entry: { id: 1 } }), line])
    assert.deepStrictEqual(ja.skipped, [3, 4])
    assert.strictEqual(ja.records.length, 2)

    const en = parseApproved(["", "{not json"])
    assert.deepStrictEqual(en.skipped, [2])
  })
})
