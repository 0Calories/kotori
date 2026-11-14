import { assert, describe, it, layer } from "@effect/vitest"
import type { DraftOutput } from "@kotori/ai"
import { EntryId } from "@kotori/contracts"
import { type DraftEntry, proposals } from "@kotori/db"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { migrationsFolder } from "../../src/db/Migrate.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { checkDraft, draftView, writeDraft } from "../../src/features/asks/draft.ts"
import { assembleEntry } from "../../src/features/dictionary/entries.ts"
import { getEntries, insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, kana, kanji, sense, U1 } from "../fixtures.ts"

type Output = NonNullable<DraftOutput["entry"]>

const output = (fields: Partial<Output> = {}): Output => ({
  headword: " bussin ",
  reading: "/ˈbʌsɪn/",
  spellings: ["bussin", "bussin'", "bussin'"],
  frequency: 4,
  senses: [
    { glosses: ["すごくおいしい", " "], pos: ["adj"], labels: ["sl", "trendy", "uk"], usagePatterns: ["若者言葉。"] },
    { glosses: [], pos: ["adj"], labels: [], usagePatterns: [] },
    { glosses: ["最高"], pos: [], labels: [], usagePatterns: [] }
  ],
  cautions: [],
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

  it("drops a sense with no gloss and moves cautions on later senses with it", () => {
    const draft = checkDraft(
      output({ cautions: [{ kind: "collocation", text: "On the third sense.", sense: 3, about: null }] }),
      "en"
    )!
    assert.deepStrictEqual(
      draft.senses.map((own) => own.glosses[0]),
      ["すごくおいしい", "最高"]
    )
    assert.deepStrictEqual(draft.cautions[0]?.sense, 1)
  })

  it("keeps out cautions that can't be right: wrong direction, unknown kind, missing sense, empty, past three", () => {
    const caution = (kind: string, sense: number | null = null, text = "Text.") => ({
      kind,
      text,
      sense,
      about: null
    })
    const draft = checkDraft(
      output({
        cautions: [
          // Wasei-eigo is a katakana loan misleading a Japanese speaker in English: never on a Japanese word.
          caution("wasei_eigo"),
          caution("made_up"),
          caution("set_phrase", 2),
          caution("set_phrase", 9),
          caution("set_phrase", null, "  "),
          caution("rude_upward"),
          caution("confusable", 1),
          caution("collocation"),
          caution("gendered_speech")
        ]
      }),
      "ja"
    )!
    assert.deepStrictEqual(
      draft.cautions.map((own) => [own.kind, own.sense]),
      [
        ["rude_upward", null],
        ["confusable", 0],
        ["collocation", null]
      ]
    )
    // "set_phrase" on sense 2: that sense had no gloss and is gone, so the caution goes too.
  })

  it("keeps frequency on its 1–5 scale, and has no draft when no sense has a gloss or no headword", () => {
    assert.strictEqual(checkDraft(output({ frequency: 9 }), "en")?.frequency, 5)
    assert.strictEqual(checkDraft(output({ frequency: 0 }), "en")?.frequency, 1)
    assert.isNull(checkDraft(output({ senses: [{ glosses: [" "], pos: [], labels: [], usagePatterns: [] }] }), "en"))
    assert.isNull(checkDraft(output({ headword: "  " }), "en"))
  })

  it("keeps only labels the word's language can carry", () => {
    const labelled = (labels: Array<string>) =>
      output({ senses: [{ glosses: ["意味"], pos: [], labels, usagePatterns: [] }] })
    assert.deepStrictEqual(
      checkDraft(labelled(["sl", "en-GB", "uncountable", "hon", "ksb"]), "en")?.senses[0]?.labels,
      ["sl", "en-GB", "uncountable"]
    )
    assert.deepStrictEqual(
      checkDraft(labelled(["sl", "en-GB", "uncountable", "hon", "ksb"]), "ja")?.senses[0]?.labels,
      ["sl", "hon", "ksb"]
    )
  })
})

const stored: DraftEntry = {
  headword: "ぴえん",
  reading: "ぴえん",
  spellings: [],
  frequency: 4,
  senses: [
    { glosses: ["boo-hoo"], pos: ["int"], labels: ["net-sl"], usagePatterns: ["Typed, mostly."] },
    { glosses: ["so sad"], pos: [], labels: ["net-sl", "joc"], usagePatterns: [] }
  ],
  cautions: [
    { kind: "confusable", text: "Not as strong as crying.", sense: null, about: "食べる" },
    // 上手 is two words (じょうず, うわて): which one is meant can't be told, so neither is linked.
    { kind: "confusable", text: "Not 上手.", sense: 0, about: "上手" },
    { kind: "confusable", text: "Not a word.", sense: 0, about: "ないことば" }
  ]
}

layer(DatabaseMemory)("drafts", (it) => {
  it.effect(
    "writes a draft as an unreviewed entry, read as any entry is, linking a named word only when one matches",
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* insertEntries(db, [
          ...entries,
          ...english,
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
        const id = yield* writeDraft(db, stored, "ja")
        const [record] = yield* getEntries(db, [id])
        assert.strictEqual(record?.review, "unreviewed")
        assert.strictEqual(record?.source, "kotori")
        const view = draftView(
          yield* assembleEntry(db, record!, Effect.succeed({ examples: "unavailable", audio: "unavailable" }))
        )
        assert.strictEqual(view.id, id)
        assert.strictEqual(view.frequency, 4)
        assert.deepStrictEqual(view.labels, [{ code: "net-sl", severity: "warning", source: "kotori" }])
        assert.deepStrictEqual(
          view.senses.map((own) => own.labels.map((label) => label.code)),
          [[], ["joc"]]
        )
        assert.deepStrictEqual(view.senses[0]?.usagePatterns, [
          { text: "Typed, mostly.", source: "kotori", about: null }
        ])
        assert.deepStrictEqual(
          view.cautions.map((caution) => caution.about?.headword ?? null),
          ["食べる", null, null]
        )
      })
  )

  it.effect("migrates drafts stored before the entry model, carrying every field over", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, { id: U1, displayName: null, createdAt: new Date(0) })
      yield* insertEntries(db, english)
      // The column the migration rewrote, as it was before drafts became entries.
      yield* db.execute(sql`ALTER TABLE "proposals" ADD COLUMN "draft" jsonb`)
      const old = (query: string, draft: object) =>
        db
          .insert(proposals)
          .values({
            language: "en",
            query,
            status: "drafted",
            entryId: null,
            reason: null,
            model: "test",
            requestedBy: U1,
            createdAt: new Date(0)
          })
          .returning({ id: proposals.id })
          .pipe(
            Effect.tap(([row]) =>
              db.execute(sql`UPDATE "proposals" SET "draft" = ${JSON.stringify(draft)}::jsonb WHERE "id" = ${row!.id}`)
            )
          )
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
          db.execute(sql`SELECT "draft" FROM "proposals" WHERE "id" = ${id}`),
          (result) => (result as { readonly rows: ReadonlyArray<{ readonly draft: unknown }> }).rows[0]?.draft
        )
      assert.deepStrictEqual(yield* draftOf(dated!.id), {
        headword: "groovy",
        reading: "",
        spellings: ["groovey"],
        frequency: 2,
        senses: [
          // "dated" was already a label: currency adds it to the senses lacking it, once.
          { glosses: ["かっこいい"], pos: ["adj"], labels: ["sl", "dated"], usagePatterns: ["60年代の言葉。"] },
          { glosses: ["最高"], pos: [], labels: ["dated"], usagePatterns: [] }
        ],
        cautions: []
      })
      assert.deepStrictEqual(yield* draftOf(trendy!.id), {
        headword: "rizz",
        reading: "/ɹɪz/",
        spellings: [],
        frequency: 4,
        senses: [{ glosses: ["魅力"], pos: ["n"], labels: ["sl"], usagePatterns: [] }],
        cautions: []
      })
    })
  )
})
