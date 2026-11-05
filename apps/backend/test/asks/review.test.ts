import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import type { DraftEntry } from "@kotori/contracts"
import { FIRST_APPROVED_JA_ID, proposalAsks, proposals, UserId } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Effect, FileSystem, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import {
  approveProposal,
  discardProposal,
  drafters,
  draftToRecord,
  listProposals,
  parseApprovedJa,
  planApproval,
  proposalAskers,
  proposalCounts
} from "../../src/features/asks/review.ts"
import { parseApproved } from "../../src/features/dictionary/import/eiwa/approved.ts"
import { findForms, getEntries, insertEntries } from "../../src/features/dictionary/queries.ts"
import { jobStatusFor } from "../../src/features/enrichment/jobs.ts"
import { senseNotesFor } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, U1 } from "../fixtures.ts"

const directory = mkdtempSync(join(tmpdir(), "approved-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const files = { en: join(directory, "en.jsonl"), ja: join(directory, "ja.jsonl") }

const draft: DraftEntry = {
  headword: "bussin",
  reading: "/ˈbʌsɪn/",
  spellings: ["bussin'"],
  currency: "trendy",
  senses: [
    { glosses: ["すごくおいしい"], partOfSpeech: "adj", labels: ["sl"], note: "若者のスラングです。" },
    { glosses: ["最高"], partOfSpeech: "adj", labels: ["sl"], note: null }
  ]
}

const jaDraft: DraftEntry = {
  headword: "蛙化現象",
  reading: "かえるかげんしょう",
  spellings: ["カエル化現象"],
  currency: "trendy",
  senses: [{ glosses: ["the ick"], partOfSpeech: "n", labels: ["sl"], note: "Young people's slang." }]
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

      // The entry is searchable by headword and spelling, with the draft's labels and notes.
      const [match] = yield* findForms(db, ["bussin'"], "en")
      assert.strictEqual(match?.entryId, approved.entryId)
      const [entry] = yield* getEntries(db, [approved.entryId])
      assert.deepStrictEqual(entry?.senses[0]?.misc, ["sl"])
      const notes = yield* senseNotesFor(db, [approved.entryId])
      assert.strictEqual(notes[0]?.noteJa, "若者のスラングです。")
      const jobs = yield* jobStatusFor(db, approved.entryId)
      assert.deepStrictEqual([...jobs.keys()].toSorted(), ["audio", "examples", "nuance"])

      // The approved file replays the entry on the next import, familiarity included.
      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.strictEqual(parsed.words[0]?.headword, "bussin")
      assert.strictEqual(parsed.words[0]?.familiarity, 4)
      assert.strictEqual(parsed.words[0]?.senses[0]?.misc.includes("sl"), true)

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

  it.effect("draftToRecord marks dated drafts the way the dictionary does", () =>
    Effect.sync(() => {
      const record = draftToRecord({ ...draft, currency: "dated" }, "en", 100_900_000 as never)
      assert.deepStrictEqual(record.senses[0]?.misc.toSorted(), ["dated", "sl"])
    })
  )
})

/** More learners, for proposals more than one person asked about. */
const U2 = UserId.make("00000000-0000-4000-8000-000000000002")
const U3 = UserId.make("00000000-0000-4000-8000-000000000003")
const U4 = UserId.make("00000000-0000-4000-8000-000000000004")

const previews = mkdtempSync(join(tmpdir(), "approved-preview-"))
afterAll(() => rmSync(previews, { recursive: true, force: true }))
const previewFiles = { en: join(previews, "en.jsonl"), ja: join(previews, "ja.jsonl") }

const asked = (db: Parameters<typeof approveProposal>[0], proposalId: number, userId: UserId, at: number) =>
  db
    .insert(proposalAsks)
    .values({ proposalId, userId, createdAt: new Date(at) })
    .pipe(Effect.orDie)

layer(TestLayer)("reviewing proposals in the console", (it) => {
  it.effect("planning an approval writes nothing, and approving then does exactly what was planned", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const fs = yield* FileSystem.FileSystem
      yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
      yield* insertEntries(db, english)
      const id = yield* propose(db, "en", "no cap", { ...draft, headword: "no cap", spellings: [] })

      const plan = yield* planApproval(db, id, previewFiles)
      assert.strictEqual(plan.kind, "entry")
      if (plan.kind !== "entry") return
      assert.strictEqual(plan.record.headword, "no cap")
      assert.deepStrictEqual(plan.jobs, ["nuance", "examples", "audio"])
      assert.deepStrictEqual(
        plan.notes.map((note) => note.noteJa),
        ["若者のスラングです。"]
      )
      // Nothing written yet: no entry, no file, still pending.
      assert.deepStrictEqual(yield* findForms(db, ["no cap"], "en"), [])
      assert.isFalse(yield* fs.exists(previewFiles.en))
      assert.strictEqual((yield* planApproval(db, id, previewFiles)).kind, "entry")

      const approved = yield* approveProposal(db, id, previewFiles)
      assert.strictEqual(approved.entryId, plan.record.id)
      const [entry] = yield* getEntries(db, [approved.entryId])
      assert.deepStrictEqual(entry?.senses, plan.record.senses)
      assert.deepStrictEqual(
        entry?.forms.map((form) => form.text),
        plan.record.forms.map((form) => form.text)
      )
      assert.strictEqual(yield* fs.readFileString(previewFiles.en), plan.line)
    })
  )

  it.effect("planning an alias names the form the entry gains, or none when it already has it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
      yield* insertEntries(db, entries)
      const id = yield* propose(db, "ja", "たべるっす", { ...jaDraft, headword: "たべるっす", spellings: [] })

      const alias = yield* planApproval(db, id, previewFiles, { aliasOf: "食べる" })
      assert.strictEqual(alias.kind, "alias")
      if (alias.kind !== "alias") return
      assert.strictEqual(alias.base.headword, "食べる")
      assert.deepStrictEqual(alias.form && [alias.form.kind, alias.form.text], ["kana", "たべるっす"])

      const existing = yield* planApproval(db, id, previewFiles, { aliasOf: "食べる", headword: "たべる" })
      assert.strictEqual(existing.kind === "alias" ? existing.form : "not an alias", undefined)

      const missing = yield* Effect.flip(planApproval(db, id, previewFiles, { aliasOf: "存在しない" }))
      assert.strictEqual(missing._tag, "NoSuchAlias")
    })
  )

  it.effect("lists proposals by status with how many asked, and counts them", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
      yield* ensureUser(db, { id: U2, displayName: null, createdAt: new Date(0) })
      const older = yield* propose(db, "en", "skibidi", draft)
      const newer = yield* db
        .insert(proposals)
        .values({
          language: "en",
          query: "gyatt",
          status: "rejected",
          draft: null,
          linkedEntryId: null,
          reason: "Not a word.",
          model: "test",
          contested: true,
          requestedBy: U1,
          createdAt: new Date(1000)
        })
        .returning()
        .pipe(
          Effect.map((rows) => rows[0]!.id),
          Effect.orDie
        )
      yield* asked(db, older, U1, 0)
      yield* asked(db, older, U2, 500)
      yield* asked(db, newer, U2, 1000)

      // Earlier tests in this suite left proposals of their own, so look at these two.
      const mine = (rows: ReadonlyArray<{ proposal: { query: string }; asks: number }>) =>
        rows.filter((row) => ["skibidi", "gyatt"].includes(row.proposal.query))
      const pending = yield* listProposals(db, { status: "pending" })
      assert.deepStrictEqual(
        mine(pending).map((row) => [row.proposal.query, row.asks]),
        [["skibidi", 2]]
      )
      const everything = yield* listProposals(db, { status: "all" })
      assert.deepStrictEqual(
        mine(everything).map((row) => row.proposal.query),
        ["gyatt", "skibidi"]
      )
      const contested = yield* listProposals(db, { status: "rejected", contested: true })
      assert.deepStrictEqual(
        contested.map((row) => row.proposal.query),
        ["gyatt"]
      )
      const counts = yield* proposalCounts(db)
      assert.strictEqual(counts.pending, pending.length)
      assert.strictEqual(counts.all, everything.length)
      assert.strictEqual(counts.contested, 1)
    })
  )

  it.effect("says who asked, first asker first, with the identity they signed up with", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const sql = yield* SqlClient.SqlClient
      // The slice of Managed Auth's schema the query reads.
      yield* sql`CREATE SCHEMA IF NOT EXISTS neon_auth`
      yield* sql`CREATE TABLE IF NOT EXISTS neon_auth."user" (id UUID PRIMARY KEY, email TEXT NOT NULL, "emailVerified" BOOLEAN NOT NULL, name TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL)`
      yield* sql`INSERT INTO neon_auth."user" (id, email, "emailVerified", name, "createdAt") VALUES (${U4}::uuid, 'emi@example.jp', true, '佐藤 恵美', now())`
      yield* ensureUser(db, { id: U4, displayName: "恵美", createdAt: new Date(0) })
      yield* ensureUser(db, { id: U3, displayName: "Dan", createdAt: new Date(0) })
      const id = yield* propose(db, "ja", "ガチ恋", jaDraft)
      yield* asked(db, id, U3, 2000)
      yield* asked(db, id, U4, 1000)

      const askers = yield* proposalAskers(db, id)
      assert.deepStrictEqual(
        askers.map((asker) => [asker.userId, asker.email, asker.name, asker.displayName]),
        [
          [U4, "emi@example.jp", "佐藤 恵美", "恵美"],
          // No identity row, as when the account was deleted: the profile still names them.
          [U3, null, null, "Dan"]
        ]
      )

      // The list names whoever's ask drafted each proposal.
      yield* db.update(proposals).set({ requestedBy: U4 }).where(eq(proposals.id, id)).pipe(Effect.orDie)
      assert.deepStrictEqual(
        (yield* drafters(db, [id])).map((row) => [row.proposalId, row.email, row.name, row.displayName]),
        [[id, "emi@example.jp", "佐藤 恵美", "恵美"]]
      )
      assert.deepStrictEqual(yield* drafters(db, []), [])
    })
  )
})
