import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { EntryId, type Source } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import { entryAttributions, entryIdFromParam, entrySourcesHref, type SourcedEntry } from "../src/lib/sources.ts"

type SourcedSense = SourcedEntry["senses"][number]

const sense = (overrides: Partial<SourcedSense> = {}): SourcedSense => ({
  labels: [],
  usagePatterns: [],
  examples: [],
  similarWords: [],
  ...overrides
})

const entry = (overrides: Partial<SourcedEntry> = {}): SourcedEntry => ({
  language: "ja",
  source: "jmdict",
  audioUrl: null,
  audio: [],
  labels: [],
  cautions: [],
  loanLink: null,
  senses: [sense()],
  ...overrides
})

const example = (source: Source, translationAudioUrl: string | null = null) => ({
  source,
  audioUrl: null,
  translationAudioUrl
})

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("entry sources", () => {
  it("opens this entry's sources screen with its id", () => {
    assert.deepStrictEqual(entrySourcesHref(EntryId.make("jmdict:1579020")), {
      pathname: "/sources/[id]",
      params: { id: "jmdict:1579020" }
    })
    assert.deepStrictEqual(entrySourcesHref(EntryId.make("en:run into")), {
      pathname: "/sources/[id]",
      params: { id: "en:run into" }
    })
    const screen = readFileSync(join(appDir, "app/entry/[id].tsx"), "utf8")
    const layout = readFileSync(join(appDir, "app/_layout.tsx"), "utf8")
    // The control on the entry, and the signed-in stack, both use that route.
    assert.match(screen, /href=\{entrySourcesHref\(/)
    assert.equal(screen.includes('"/settings"'), false)
    assert.match(layout, /Stack\.Screen name="sources\/\[id\]"/)
    assert.match(readFileSync(join(appDir, "app/sources/[id].tsx"), "utf8"), /entryAttributions\(/)
  })

  it("reads deterministic string entry ids (including URL-encoded spaces/punctuation) from route params", () => {
    assert.equal(entryIdFromParam("jmdict:1579020"), "jmdict:1579020")
    assert.equal(entryIdFromParam(["en:May"]), "en:May")
    assert.equal(entryIdFromParam("en%3Arun%20into"), "en:run into")
    assert.equal(entryIdFromParam("en:rock%20'n'%20roll"), "en:rock 'n' roll")
    assert.equal(entryIdFromParam("kotori:abc-123"), "kotori:abc-123")
    assert.equal(entryIdFromParam(undefined), null)
    assert.equal(entryIdFromParam(""), null)
    assert.equal(entryIdFromParam("12345"), null)
    assert.equal(entryIdFromParam("en:"), null)
    assert.equal(entryIdFromParam("nope:123"), null)
    assert.equal(entryIdFromParam(["jmdict:1", "jmdict:2"]), "jmdict:1")
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
      source: "enwiktionary",
      audioUrl: "/audio/head",
      loanLink: { source: "jmdict", meaningSource: null },
      cautions: [{ source: "kotori" }],
      senses: [
        sense({
          examples: [example("kotori"), example("tatoeba"), example("jawiktionary")],
          similarWords: [{}]
        })
      ]
    })
    assert.deepStrictEqual(
      entryAttributions(strings.en, rich).map((row) => row.id),
      ["dictionary", "kotori", "examples", "tatoeba", "wiktionary", "similar", "audio", "loan"]
    )
    assert.equal(
      entryAttributions(strings.en, rich).find((row) => row.id === "loan")?.body,
      strings.en.entry.sourceLoanDictionary
    )

    // A translation clip is pronunciation even when the headword has none; seeded sentences
    // aren't Kotori's, so they don't credit Claude.
    const spoken = entry({ senses: [sense({ examples: [example("tatoeba", "/audio/en")] })] })
    assert.deepStrictEqual(
      entryAttributions(strings.en, spoken).map((row) => row.id),
      ["dictionary", "tatoeba", "audio"]
    )

    // A Japanese word's loan is its own dictionary's; Kotori's verdict on it is credited, whoever
    // named the pair, and on an English word beside JMDict's naming of it.
    assert.deepStrictEqual(
      entryAttributions(strings.en, entry({ loanLink: { source: "jmdict", meaningSource: null } })).map(
        (row) => row.id
      ),
      ["dictionary"]
    )
    assert.equal(
      entryAttributions(strings.en, entry({ loanLink: { source: "kotori", meaningSource: "kotori" } })).at(-1)?.body,
      strings.en.entry.sourceLoanKotori
    )
    assert.equal(
      entryAttributions(strings.en, entry({ loanLink: { source: "jmdict", meaningSource: "kotori" } })).at(-1)?.body,
      strings.en.entry.sourceLoanKotori
    )
    const judgedEnglish = entry({
      language: "en",
      source: "enwiktionary",
      loanLink: { source: "jmdict", meaningSource: "kotori" }
    })
    assert.equal(entryAttributions(strings.en, judgedEnglish).at(-1)?.body, strings.en.entry.sourceLoanBoth)
    assert.equal(entryAttributions(strings.ja, judgedEnglish).at(-1)?.body, strings.ja.entry.sourceLoanBoth)

    // A Kotori label or note is credited; on an approved Ask Kotori word the dictionary row says it.
    const marked = entry({ senses: [sense({ usagePatterns: [{ source: "kotori" }] })] })
    assert.deepStrictEqual(
      entryAttributions(strings.en, marked).map((row) => row.id),
      ["dictionary", "kotori"]
    )
    const approved = entryAttributions(strings.en, { ...marked, source: "kotori" })
    assert.deepStrictEqual(
      approved.map((row) => row.id),
      ["dictionary"]
    )
    assert.equal(approved[0]?.body, strings.en.entry.sourceDictionaryKotori)

    for (const row of entryAttributions(strings.ja, rich)) {
      assert.ok(row.title.length > 0)
      assert.ok(row.body.length > 0)
      const englishRow = entryAttributions(strings.en, rich).find((other) => other.id === row.id)
      assert.notEqual(row.title, englishRow?.title)
      assert.notEqual(row.body, englishRow?.body)
    }
  })
})
