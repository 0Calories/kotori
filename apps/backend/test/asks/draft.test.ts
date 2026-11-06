import { assert, describe, it, layer } from "@effect/vitest"
import type { DraftOutput } from "@kotori/ai"
import { EntryId } from "@kotori/contracts"
import { type DraftEntry, proposals } from "@kotori/db"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { migrationsFolder } from "../../src/db/Migrate.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { checkDraft, viewDraft } from "../../src/features/asks/draft.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, kana, kanji, sense, U1 } from "../fixtures.ts"

type Output = NonNullable<DraftOutput["entry"]>

const output = (fields: Partial<Output> = {}): Output => ({
  headword: " bussin ",
  reading: "/ˈbʌsɪn/",
  spellings: ["bussin", "bussin'", "bussin'"],
  familiarity: 4,
  senses: [
    { glosses: ["すごくおいしい", " "], pos: ["adj"], labels: ["sl", "trendy", "uk"], patterns: ["若者言葉。"] },
    { glosses: [], pos: ["adj"], labels: [], patterns: [] },
    { glosses: ["最高"], pos: [], labels: [], patterns: [] }
  ],
  pitfalls: [],
  ...fields
})

describe("checkDraft", () => {
  it("trims and dedupes, drops the headword from its spellings, and keeps only vocabulary labels", () => {
    const draft = checkDraft(output(), "en")!
    assert.strictEqual(draft.headword, "bussin")
    assert.deepStrictEqual(draft.spellings, ["bussin'"])
    // "trendy" isn't a label, and "uk" is a spelling fact, not a usage label.
    assert.deepStrictEqual(draft.senses[0]?.labels, ["sl"])
    assert.deepStrictEqual(draft.senses[0]?.glosses, ["すごくおいしい"])
  })

  it("drops a sense with no gloss and moves pitfalls on later senses with it", () => {
    const draft = checkDraft(
      output({ pitfalls: [{ kind: "collocation", text: "On the third sense.", sense: 3, about: null }] }),
      "en"
    )!
    assert.deepStrictEqual(
      draft.senses.map((own) => own.glosses[0]),
      ["すごくおいしい", "最高"]
    )
    assert.deepStrictEqual(draft.pitfalls[0]?.sense, 1)
  })

  it("keeps out pitfalls that can't be right: wrong direction, unknown kind, missing sense, empty, past three", () => {
    const pitfall = (kind: string, sense: number | null = null, text = "Text.") => ({ kind, text, sense, about: null })
    const draft = checkDraft(
      output({
        pitfalls: [
          // A false friend is a katakana loan misleading a Japanese speaker: never on a Japanese word.
          pitfall("false_friend"),
          pitfall("made_up"),
          pitfall("set_phrase", 2),
          pitfall("set_phrase", 9),
          pitfall("set_phrase", null, "  "),
          pitfall("rude_upward"),
          pitfall("confusable", 1),
          pitfall("collocation"),
          pitfall("gendered_speech")
        ]
      }),
      "ja"
    )!
    assert.deepStrictEqual(
      draft.pitfalls.map((own) => [own.kind, own.sense]),
      [
        ["rude_upward", null],
        ["confusable", 0],
        ["collocation", null]
      ]
    )
    // "set_phrase" on sense 2: that sense had no gloss and is gone, so the pitfall goes too.
  })

  it("keeps familiarity on its 1–5 scale, and has no draft when no sense has a gloss", () => {
    assert.strictEqual(checkDraft(output({ familiarity: 9 }), "en")?.familiarity, 5)
    assert.strictEqual(checkDraft(output({ familiarity: 0 }), "en")?.familiarity, 1)
    assert.isNull(checkDraft(output({ senses: [{ glosses: [" "], pos: [], labels: [], patterns: [] }] }), "en"))
  })
})

const stored: DraftEntry = {
  headword: "ぴえん",
  reading: "ぴえん",
  spellings: [],
  familiarity: 4,
  senses: [
    { glosses: ["boo-hoo"], pos: ["int"], labels: ["net-sl"], patterns: ["Typed, mostly."] },
    { glosses: ["so sad"], pos: [], labels: ["net-sl", "joc"], patterns: [] }
  ],
  pitfalls: [
    { kind: "confusable", text: "Not as strong as crying.", sense: null, about: "食べる" },
    // 上手 is two words (じょうず, うわて): which one is meant can't be told, so neither is linked.
    { kind: "confusable", text: "Not 上手.", sense: 0, about: "上手" },
    { kind: "confusable", text: "Not a word.", sense: 0, about: "ないことば" }
  ]
}

layer(DatabaseMemory)("drafts", (it) => {
  it.effect("reads a stored draft as an entry is read, linking a named word only when one matches", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        ...entries,
        {
          ...entries[0]!,
          id: EntryId.make(1900001),
          headword: "上手",
          reading: "じょうず",
          forms: [kanji("上手"), kana("じょうず")],
          senses: [sense(["skillful"])]
        },
        {
          ...entries[0]!,
          id: EntryId.make(1900002),
          headword: "上手",
          reading: "うわて",
          forms: [kanji("上手"), kana("うわて")],
          senses: [sense(["upper part"])]
        }
      ])
      const view = yield* viewDraft(db, stored, "ja")
      assert.deepStrictEqual(view.labels, [{ code: "net-sl", severity: "caution", source: "kotori" }])
      assert.deepStrictEqual(
        view.senses.map((own) => own.labels.map((label) => label.code)),
        [[], ["joc"]]
      )
      assert.deepStrictEqual(view.senses[0]?.patterns, [{ text: "Typed, mostly.", source: "kotori", about: null }])
      assert.deepStrictEqual(
        view.pitfalls.map((pitfall) => pitfall.about?.headword ?? null),
        ["食べる", null, null]
      )
    })
  )

  it.effect("migrates drafts stored before the entry model, carrying every field over", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
      yield* insertEntries(db, english)
      const old = (query: string, draft: object) =>
        db
          .insert(proposals)
          .values({
            language: "en",
            query,
            status: "pending",
            draft: sql`${JSON.stringify(draft)}::jsonb` as never,
            linkedEntryId: null,
            reason: null,
            model: "test",
            requestedBy: U1,
            createdAt: new Date(0)
          })
          .returning({ id: proposals.id })
      const [dated] = yield* old("groovy", {
        headword: "groovy",
        reading: "",
        spellings: ["groovey"],
        currency: "dated",
        senses: [
          { glosses: ["かっこいい"], partOfSpeech: "adj", labels: ["sl", "dated"], note: " 60年代の言葉。 " },
          { glosses: ["最高"], partOfSpeech: null, labels: [], note: "" }
        ]
      })
      const [trendy] = yield* old("rizz", {
        headword: "rizz",
        reading: "/ɹɪz/",
        spellings: [],
        currency: "trendy",
        senses: [{ glosses: ["魅力"], partOfSpeech: "n", labels: ["sl"], note: null }]
      })

      // The migration as it ships; already-migrated drafts are left alone, so it runs again safely.
      const folder = readdirSync(migrationsFolder).find((name) => name.endsWith("proposal_drafts_on_entry_model"))!
      const statement = readFileSync(join(migrationsFolder, folder, "migration.sql"), "utf8")
      yield* db.execute(sql.raw(statement))
      yield* db.execute(sql.raw(statement))

      const draftOf = (id: number) =>
        Effect.map(
          db.select({ draft: proposals.draft }).from(proposals).where(eq(proposals.id, id)),
          (rows) => rows[0]?.draft
        )
      assert.deepStrictEqual(yield* draftOf(dated!.id), {
        headword: "groovy",
        reading: "",
        spellings: ["groovey"],
        familiarity: 2,
        senses: [
          // "dated" was already a label: currency adds it to the senses lacking it, once.
          { glosses: ["かっこいい"], pos: ["adj"], labels: ["sl", "dated"], patterns: ["60年代の言葉。"] },
          { glosses: ["最高"], pos: [], labels: ["dated"], patterns: [] }
        ],
        pitfalls: []
      })
      assert.deepStrictEqual(yield* draftOf(trendy!.id), {
        headword: "rizz",
        reading: "/ɹɪz/",
        spellings: [],
        familiarity: 4,
        senses: [{ glosses: ["魅力"], pos: ["n"], labels: ["sl"], patterns: [] }],
        pitfalls: []
      })
    })
  )
})
