import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { assert, describe, it, layer } from "@effect/vitest"
import {
  cautions,
  type DraftEntry,
  entries,
  entryFrequency,
  EntryId,
  FIRST_APPROVED_JA_ID,
  labels,
  NoteId,
  notes,
  proposals,
  usagePatterns
} from "@kotori/db"
import { asc, eq } from "drizzle-orm"
import { Effect, FileSystem, Layer } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { Database } from "../../src/db/Database.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { draftToRecord, writeDraft } from "../../src/features/asks/draft.ts"
import { approveProposal, discardProposal, parseApprovedJa } from "../../src/features/asks/review.ts"
import { parseApproved } from "../../src/features/dictionary/import/english/approved.ts"
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

/** A drafted proposal as Ask Kotori leaves one: its draft an unreviewed entry. */
const propose = Effect.fnUntraced(function* (
  db: Parameters<typeof approveProposal>[0],
  language: "en" | "ja",
  query: string,
  entry: DraftEntry
) {
  const entryId = yield* writeDraft(db, entry, language)
  const [row] = yield* db
    .insert(proposals)
    .values({
      language,
      query,
      status: "drafted",
      entryId,
      reason: null,
      model: "test",
      requestedBy: U1,
      createdAt: new Date(0)
    })
    .returning()
    .pipe(Effect.orDie)
  return { id: row!.id, entryId }
})

/** U1's note on an entry, as a learner who saved the draft has. */
const saveNote = (db: Parameters<typeof approveProposal>[0], entryId: EntryId, senses: Array<number> | null) =>
  db
    .insert(notes)
    .values({
      id: NoteId.make(crypto.randomUUID()),
      userId: U1,
      entryId,
      senses,
      due: new Date(0),
      seed: 1,
      position: 0
    })
    .pipe(Effect.orDie)

const reviewOf = (db: Parameters<typeof approveProposal>[0], entryId: EntryId) =>
  db
    .select({ review: entries.review })
    .from(entries)
    .where(eq(entries.id, entryId))
    .pipe(
      Effect.map((rows) => rows[0]?.review),
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

      const { id, entryId } = yield* propose(db, "en", "bussin", draft)
      // Until approved, the draft is an unreviewed entry a link never lands on, and a learner can save it.
      assert.strictEqual(yield* reviewOf(db, entryId), "unreviewed")
      assert.deepStrictEqual(yield* findForms(db, ["bussin'"], "en"), [])
      assert.strictEqual((yield* findForms(db, ["bussin'"], "en", "listed"))[0]?.entryId, entryId)
      yield* saveNote(db, entryId, [1])
      // Nothing is enriched before approval.
      assert.strictEqual((yield* jobStatusFor(db, entryId)).size, 0)

      const approved = yield* approveProposal(db, id, files)
      assert.strictEqual(approved.headword, "bussin")
      // Approval changes only where the entry stands: the same entry, and the note on it, stay.
      assert.strictEqual(approved.entryId, entryId)
      assert.strictEqual(yield* reviewOf(db, entryId), "approved")
      assert.deepStrictEqual(
        yield* db
          .select({ entryId: notes.entryId, senses: notes.senses })
          .from(notes)
          .where(eq(notes.entryId, entryId)),
        [{ entryId, senses: [1] }]
      )

      // The entry is searchable by headword and spelling, with the draft's labels, usage patterns and
      // cautions as Kotori's, the caution linked to the word it names.
      const [match] = yield* findForms(db, ["bussin'"], "en")
      assert.strictEqual(match?.entryId, approved.entryId)
      const [entry] = yield* getEntries(db, [approved.entryId])
      assert.strictEqual(entry?.source, "kotori")
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
          .select({ sense: usagePatterns.sense, text: usagePatterns.text, source: usagePatterns.source })
          .from(usagePatterns)
          .where(eq(usagePatterns.entryId, approved.entryId)),
        [{ sense: 0, text: "若者のスラングです。", source: "kotori" }]
      )
      assert.deepStrictEqual(
        yield* db
          .select({
            rank: cautions.rank,
            kind: cautions.kind,
            sense: cautions.sense,
            about: cautions.aboutEntryId
          })
          .from(cautions)
          .where(eq(cautions.entryId, approved.entryId))
          .orderBy(asc(cautions.rank)),
        [
          { rank: 1, kind: "collocation", sense: 0, about: english[0]!.id },
          { rank: 2, kind: "variety", sense: null, about: null }
        ]
      )
      // The draft's frequency score is stored from the moment it is approved.
      assert.deepStrictEqual(
        yield* db.select().from(entryFrequency).where(eq(entryFrequency.entryId, approved.entryId)),
        [{ entryId: approved.entryId, everyday: false, spokenCount: null, score: 4 }]
      )
      const jobs = yield* jobStatusFor(db, approved.entryId)
      assert.deepStrictEqual([...jobs.keys()].toSorted(), ["audio", "examples"])

      // The approved file replays the entry on the next import, frequency included.
      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.strictEqual(parsed.words[0]?.headword, "bussin")
      assert.strictEqual(parsed.words[0]?.frequency, 4)
      assert.strictEqual(parsed.words[0]?.senses[0]?.misc.includes("sl"), true)
      assert.deepStrictEqual(parsed.words[0]?.senses[0]?.info, ["若者のスラングです。"])
      assert.deepStrictEqual(parsed.words[0]?.cautions, draft.cautions)

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

      const { id, entryId } = yield* propose(db, "en", "it be like it be", {
        ...draft,
        headword: "it be like it be",
        spellings: []
      })
      yield* saveNote(db, entryId, [1])
      const approved = yield* approveProposal(db, id, files, { aliasOf: "eat" })
      assert.strictEqual(approved.alias, "it be like it be")
      const matches = yield* findForms(db, ["it be like it be"], "en")
      assert.strictEqual(matches[0]?.entryId, approved.entryId)
      assert.strictEqual(approved.headword, "eat")
      // The draft's entry goes; its note and its proposal now name the word it spells, every sense shown.
      assert.strictEqual(yield* reviewOf(db, entryId), undefined)
      assert.deepStrictEqual(
        yield* db
          .select({ entryId: notes.entryId, senses: notes.senses })
          .from(notes)
          .where(eq(notes.entryId, approved.entryId)),
        [{ entryId: approved.entryId, senses: null }]
      )
      assert.deepStrictEqual(
        yield* db.select({ entryId: proposals.entryId }).from(proposals).where(eq(proposals.id, id)),
        [{ entryId: approved.entryId }]
      )

      const parsed = parseApproved((yield* fs.readFileString(files.en)).split("\n"))
      assert.deepStrictEqual(parsed.formsOf.at(-1), { text: "it be like it be", base: "eat", tags: [] })
    })
  )

  it.effect("a Japanese draft gets an id in the approved range and comes back from its file", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const fs = yield* FileSystem.FileSystem
      yield* seeded

      const { id } = yield* propose(db, "ja", "蛙化現象", jaDraft)
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
      assert.deepStrictEqual(parsed.records[0]?.frequency, { everyday: false, spokenCount: null, score: 3 })
      assert.deepStrictEqual(
        yield* db
          .select({ score: entryFrequency.score })
          .from(entryFrequency)
          .where(eq(entryFrequency.entryId, approved.entryId)),
        [{ score: 3 }]
      )
      assert.deepStrictEqual(parsed.cautions, [{ entryId: approved.entryId, cautions: jaDraft.cautions }])
    })
  )

  it.effect("discarding keeps the entry, hidden, as a negative cache and for the notes that saved it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seeded
      const { id, entryId } = yield* propose(db, "en", "slopword", { ...draft, headword: "slopword", spellings: [] })
      yield* saveNote(db, entryId, null)
      const discarded = yield* discardProposal(db, id, "not established usage")
      assert.strictEqual(discarded.query, "slopword")
      assert.strictEqual(yield* reviewOf(db, entryId), "discarded")
      assert.deepStrictEqual(yield* findForms(db, ["slopword"], "en", "listed"), [])
      assert.strictEqual((yield* db.select().from(notes).where(eq(notes.entryId, entryId))).length, 1)
      const approving = yield* Effect.flip(approveProposal(db, id, files))
      assert.deepStrictEqual(
        [approving._tag, "status" in approving ? approving.status : null],
        ["NotPending", "discarded"]
      )
      const again = yield* Effect.flip(discardProposal(db, id, null))
      assert.strictEqual(again._tag, "NotPending")
    })
  )

  it.effect("draftToRecord stores labels and usage patterns where the import reads them", () =>
    Effect.sync(() => {
      const record = draftToRecord(draft, "en", 100_900_000 as never)
      assert.deepStrictEqual(record.senses[0]?.misc, ["sl"])
      assert.deepStrictEqual(record.senses[0]?.info, ["若者のスラングです。"])
      assert.deepStrictEqual(record.senses[0]?.pos, ["adj"])
    })
  )
})

describe("approved files", () => {
  it("loads a Japanese line written before entries named their source, as an Ask Kotori word", () => {
    const { source: _, ...old } = draftToRecord(jaDraft, "ja", EntryId.make(FIRST_APPROVED_JA_ID))
    const parsed = parseApprovedJa([JSON.stringify({ entry: old })])
    assert.deepStrictEqual(parsed.skipped, [])
    assert.strictEqual(parsed.records[0]?.id, FIRST_APPROVED_JA_ID)
    assert.strictEqual(parsed.records[0]?.source, "kotori")
  })

  it("names the lines it can't read, by line number, instead of losing them silently", () => {
    const line = JSON.stringify({ entry: draftToRecord(jaDraft, "ja", EntryId.make(FIRST_APPROVED_JA_ID)) })
    const ja = parseApprovedJa([line, "", "{not json", JSON.stringify({ entry: { id: "x" } }), line])
    assert.deepStrictEqual(ja.skipped, [3, 4])
    assert.strictEqual(ja.records.length, 2)

    const en = parseApproved(["", "{not json"])
    assert.deepStrictEqual(en.skipped, [2])
  })
})
