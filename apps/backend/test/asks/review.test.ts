import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { type DraftEntry, EntryId, kotoriEntryId, proposals } from "@kotori/db"
import { Effect, FileSystem, Layer, Option } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { draftToEntryRecord } from "../../src/features/asks/draft.ts"
import { approveProposal, discardProposal, mergeProposal } from "../../src/features/asks/review.ts"
import { Dictionary } from "../../src/features/dictionary/Dictionary.ts"
import { exportKotoriEntries, importKotoriEntries } from "../../src/features/dictionary/kotoriBackup.ts"
import { deleteEntries, insertEntries, saveKotoriCautions } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, U1 } from "../fixtures.ts"

const directory = mkdtempSync(join(tmpdir(), "kotori-backup-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

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

/** Inserts an unreviewed `kotori:` entry directly in `entries` + `entry_search` and links a pending proposal. */
const proposeDraft = Effect.fnUntraced(function* (
  db: Parameters<typeof approveProposal>[0],
  language: "en" | "ja",
  query: string,
  entry: DraftEntry,
  idSuffix: string
) {
  const entryId = kotoriEntryId(idSuffix)
  yield* insertEntries(db, [draftToEntryRecord(entry, language, entryId)], {
    seeded: true,
    reviewState: "unreviewed"
  })
  if (entry.cautions.length > 0) {
    yield* saveKotoriCautions(db, entryId, language, entry.cautions)
  }
  const [row] = yield* db
    .insert(proposals)
    .values({
      language,
      query,
      status: "pending",
      linkedEntryId: entryId,
      reason: null,
      model: "test",
      requestedBy: U1,
      createdAt: new Date(0)
    })
    .returning()
    .pipe(Effect.orDie)
  return { proposalId: row!.id, entryId }
})

const seeded = Effect.gen(function* () {
  const db = yield* Database
  yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
  yield* insertEntries(db, english)
})

const TestLayer = Layer.mergeAll(Dictionary.layer, NodeFileSystem.layer, NodePath.layer).pipe(
  Layer.provideMerge(DatabaseMemory)
)

layer(TestLayer)("admin review lifecycle and kotori: CLI export/import", (it) => {
  it.effect("approves an unreviewed Drafted entry in place without changing its kotori: ID", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* seeded

      const { proposalId, entryId } = yield* proposeDraft(db, "en", "bussin", draft, "bussin-1")

      // Before approval: searchable and flagged unreviewed.
      const before = yield* dictionary.search("bussin'", "en", 10)
      assert.strictEqual(before.entries[0]?.id, entryId)
      assert.strictEqual(before.entries[0]?.reviewState, "unreviewed")

      // Approve in place: same kotori: ID, promoted to approved.
      const approved = yield* approveProposal(db, proposalId)
      assert.strictEqual(approved.entryId, entryId)
      assert.strictEqual(approved.headword, "bussin")

      const after = yield* dictionary.search("bussin'", "en", 10)
      assert.strictEqual(after.entries[0]?.id, entryId)
      assert.strictEqual(after.entries[0]?.reviewState, "approved")

      const entry = Option.getOrThrow(yield* dictionary.entry(entryId))
      assert.strictEqual(entry.source, "kotori")
      assert.strictEqual(entry.reviewState, "approved")
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

      // Approving twice is refused.
      const again = yield* Effect.flip(approveProposal(db, proposalId))
      assert.strictEqual(again._tag, "NotPending")
    })
  )

  it.effect("discards an unreviewed Drafted entry, hides it from search, and keeps a tombstone", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* seeded

      const { proposalId, entryId } = yield* proposeDraft(
        db,
        "en",
        "slopword",
        { ...draft, headword: "slopword", spellings: [] },
        "slopword-1"
      )
      assert.strictEqual((yield* dictionary.search("slopword", "en", 10)).entries[0]?.id, entryId)

      const discarded = yield* discardProposal(db, proposalId, "not established usage")
      assert.strictEqual(discarded.query, "slopword")
      assert.strictEqual(discarded.entryId, entryId)

      // Hidden from search.
      const searchAfter = yield* dictionary.search("slopword", "en", 10)
      assert.isFalse(searchAfter.entries.some((e) => e.id === entryId))

      // Tombstone stays in entries so direct lookups know it was discarded.
      const direct = Option.getOrThrow(yield* dictionary.entry(entryId))
      assert.strictEqual(direct.reviewState, "discarded")

      const again = yield* Effect.flip(discardProposal(db, proposalId, null))
      assert.strictEqual(again._tag, "NotPending")
    })
  )

  it.effect("merges a duplicate Drafted entry into a canonical Entry via redirect_to", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* seeded

      const { proposalId, entryId } = yield* proposeDraft(
        db,
        "en",
        "eatin good",
        { ...draft, headword: "eatin good", spellings: [] },
        "dup-eat"
      )
      const canonicalId = EntryId.make("en:eat")
      const merged = yield* mergeProposal(db, proposalId, canonicalId)
      assert.strictEqual(merged.entryId, entryId)
      assert.strictEqual(merged.targetEntryId, canonicalId)
      assert.strictEqual(merged.headword, "eat")

      // Duplicate row is hidden from search.
      const search = yield* dictionary.search("eatin good", "en", 10)
      assert.isFalse(search.entries.some((e) => e.id === entryId))

      // Direct lookup of the merged kotori: ID transparently resolves to the canonical Entry.
      const resolved = Option.getOrThrow(yield* dictionary.entry(entryId))
      assert.strictEqual(resolved.id, canonicalId)
      assert.strictEqual(resolved.headword, "eat")
      assert.strictEqual(resolved.reviewState, "approved")
    })
  )

  it.effect("exports and restores kotori: entries across all states without touching external rows", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const unreviewed = yield* proposeDraft(db, "ja", "蛙化現象", jaDraft, "export-unreviewed")
      const approved = yield* proposeDraft(
        db,
        "en",
        "rizz",
        { ...draft, headword: "rizz", spellings: [] },
        "export-approved"
      )
      yield* approveProposal(db, approved.proposalId)

      const discarded = yield* proposeDraft(
        db,
        "en",
        "bogusword",
        { ...draft, headword: "bogusword", spellings: [] },
        "export-discarded"
      )
      yield* discardProposal(db, discarded.proposalId, "nope")

      const merged = yield* proposeDraft(
        db,
        "en",
        "eatdup",
        { ...draft, headword: "eatdup", spellings: [] },
        "export-merged"
      )
      yield* mergeProposal(db, merged.proposalId, EntryId.make("en:eat"))

      const dumpFile = join(directory, "kotori-entries.jsonl")
      const exported = yield* exportKotoriEntries(db, dumpFile)
      assert.isAtLeast(exported.exported, 4)

      // Append an invalid line and an external entry line to verify import skips them cleanly.
      const existingText = yield* fs.readFileString(dumpFile)
      yield* fs.writeFileString(dumpFile, existingText + "{not json\n" + JSON.stringify({ id: "en:eat" }) + "\n")

      // Delete all 4 kotori: rows from the DB, then restore from dumpFile.
      const kotoriIds = [unreviewed.entryId, approved.entryId, discarded.entryId, merged.entryId]
      yield* deleteEntries(db, kotoriIds)
      for (const id of kotoriIds) {
        assert.isTrue(Option.isNone(yield* dictionary.entry(id)))
      }

      const imported = yield* importKotoriEntries(db, dumpFile)
      assert.isAtLeast(imported.imported, 4)
      assert.strictEqual(imported.skipped.length, 2)

      // All 4 states and search projections are restored accurately.
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(unreviewed.entryId)).reviewState, "unreviewed")
      assert.strictEqual((yield* dictionary.search("蛙化現象", "ja", 10)).entries[0]?.id, unreviewed.entryId)
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(approved.entryId)).reviewState, "approved")
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(discarded.entryId)).reviewState, "discarded")
      assert.isFalse((yield* dictionary.search("bogusword", "en", 10)).entries.some((e) => e.id === discarded.entryId))
      assert.strictEqual(Option.getOrThrow(yield* dictionary.entry(merged.entryId)).id, EntryId.make("en:eat"))
      assert.isFalse((yield* dictionary.search("eatdup", "en", 10)).entries.some((e) => e.id === merged.entryId))
    })
  )
})
