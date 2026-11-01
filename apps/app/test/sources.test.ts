import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import { entryAttributions, entryIdFromParam, entrySourcesHref, type SourcedEntry } from "../src/lib/sources.ts"

const entry = (overrides: Partial<SourcedEntry> = {}): SourcedEntry => ({
  language: "ja",
  audioUrl: null,
  audio: [],
  loan: null,
  senses: [{ nuance: null, examples: [], similar: [] }],
  ...overrides
})

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("entry sources", () => {
  it("opens this entry's sources screen with its id", () => {
    assert.deepStrictEqual(entrySourcesHref(1579020), {
      pathname: "/sources/[id]",
      params: { id: "1579020" }
    })
    const screen = readFileSync(join(appDir, "app/entry/[id].tsx"), "utf8")
    const layout = readFileSync(join(appDir, "app/_layout.tsx"), "utf8")
    // The control on the entry, and the signed-in stack, both use that route.
    assert.match(screen, /href=\{entrySourcesHref\(/)
    assert.equal(screen.includes('"/settings"'), false)
    assert.match(layout, /Stack\.Screen name="sources\/\[id\]"/)
    assert.match(readFileSync(join(appDir, "app/sources/[id].tsx"), "utf8"), /entryAttributions\(/)
  })

  it("reads the entry id from a web or native route param", () => {
    assert.equal(entryIdFromParam("100000042"), 100000042)
    assert.equal(entryIdFromParam(["100000042"]), 100000042)
    assert.equal(entryIdFromParam(undefined), null)
    assert.equal(entryIdFromParam(""), null)
    assert.equal(entryIdFromParam("0"), null)
    assert.equal(entryIdFromParam("nope"), null)
    assert.equal(entryIdFromParam(["1", "2"]), 1)
  })

  it("credits the dictionary the word comes from, and only the parts the entry has", () => {
    const japanese = entryAttributions(strings.en, entry())
    assert.deepStrictEqual(
      japanese.map((row) => row.id),
      ["dictionary"]
    )
    assert.equal(japanese[0]?.body, strings.en.entry.sourceDictionaryJa)
    assert.equal(entryAttributions(strings.ja, entry())[0]?.body, strings.ja.entry.sourceDictionaryJa)

    const english = entryAttributions(strings.en, entry({ language: "en" }))
    assert.equal(english[0]?.body, strings.en.entry.sourceDictionaryEn)
    assert.notEqual(english[0]?.body, japanese[0]?.body)

    const rich = entry({
      language: "en",
      audioUrl: "/audio/head",
      loan: { word: "スタイル" },
      senses: [
        { nuance: { formality: "neutral" }, examples: [{ audioUrl: null, translationAudioUrl: null }], similar: [{}] }
      ]
    })
    assert.deepStrictEqual(
      entryAttributions(strings.en, rich).map((row) => row.id),
      ["dictionary", "nuance", "examples", "similar", "audio", "loan"]
    )

    // A translation clip is pronunciation even when the headword has none.
    const spoken = entry({
      audioUrl: null,
      senses: [{ nuance: null, examples: [{ audioUrl: null, translationAudioUrl: "/audio/en" }], similar: [] }]
    })
    assert.deepStrictEqual(
      entryAttributions(strings.en, spoken).map((row) => row.id),
      ["dictionary", "examples", "audio"]
    )

    for (const row of entryAttributions(strings.ja, rich)) {
      assert.ok(row.title.length > 0)
      assert.ok(row.body.length > 0)
      const englishRow = entryAttributions(strings.en, rich).find((other) => other.id === row.id)
      assert.notEqual(row.title, englishRow?.title)
      assert.notEqual(row.body, englishRow?.body)
    }
  })
})
