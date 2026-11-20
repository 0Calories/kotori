import { EntryId, type FormRecord, type SenseOrigin } from "@kotori/contracts"
import type { ImportEntry, ImportSense, SeedExample, SeedFrequency } from "../seedFacts.ts"

export interface JMDictTag {
  readonly code: string
  readonly name: string
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }

// JMdict encodes tag codes as XML entity references (e.g. &v1;), so preserve non-standard entity names as bare codes.
const decodeText = (raw: string) =>
  raw.replace(/&([\w-]+);/g, (whole, name: string) => XML_ENTITIES[name] ?? name).trim()

const ENTITY_DECLARATION = /<!ENTITY\s+([\w-]+)\s+"([^"]*)">/g

export const parseTags = (xml: string): Array<JMDictTag> => {
  const end = xml.indexOf("]>")
  const dtd = end === -1 ? "" : xml.slice(0, end)
  const tags = new Map<string, string>()
  for (const [, code, name] of dtd.matchAll(ENTITY_DECLARATION)) {
    if (!tags.has(code!)) tags.set(code!, name!)
  }
  return Array.from(tags, ([code, name]) => ({ code, name }))
}

const elements = (block: string, name: string): Array<string> =>
  Array.from(block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g")), (match) =>
    decodeText(match[1]!)
  )

const first = (block: string, name: string) => elements(block, name)[0]

const blocks = (block: string, name: string): Array<string> =>
  Array.from(block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g")), (match) => match[1]!)

const COMMON_MARKERS = new Set(["news1", "ichi1", "spec1", "spec2", "gai1"])

const MARKER_WEIGHT: Record<string, number> = {
  ichi1: 40,
  spec1: 25,
  news1: 20,
  gai1: 20,
  spec2: 15,
  ichi2: 10,
  news2: 5,
  gai2: 5
}

// JMdict nf01..nf48 markers rank newspaper frequency in 500-word bands from most frequent.
export const priorityScore = (priorities: ReadonlyArray<string>) =>
  Math.round(
    priorities.reduce((score, marker) => {
      const band = /^nf(\d\d)$/.exec(marker)
      if (band) return score + (49 - Number(band[1])) * 1.5
      return score + (MARKER_WEIGHT[marker] ?? 0)
    }, 0)
  )

export const isCommon = (priorities: ReadonlyArray<string>) => priorities.some((marker) => COMMON_MARKERS.has(marker))

// Keep ateji (e.g. 寿司) visible since it is often the standard spelling.
const HIDDEN_KANJI = new Set(["sK", "rK", "iK", "oK", "io"])
const HIDDEN_KANA = new Set(["sk", "ik", "ok"])

const parseKanji = (block: string): FormRecord => {
  const priorities = elements(block, "ke_pri")
  return {
    kind: "kanji",
    text: first(block, "keb") ?? "",
    common: isCommon(priorities),
    tags: elements(block, "ke_inf"),
    priorities,
    restrictions: [],
    noKanji: false
  }
}

const parseKana = (block: string): FormRecord => {
  const priorities = elements(block, "re_pri")
  return {
    kind: "kana",
    text: first(block, "reb") ?? "",
    common: isCommon(priorities),
    tags: elements(block, "re_inf"),
    priorities,
    restrictions: elements(block, "re_restr"),
    noKanji: block.includes("<re_nokanji")
  }
}

const parseOrigins = (block: string) => {
  const origins: Array<SenseOrigin> = []
  let wasei = false
  for (const [, attributes = "", text = ""] of block.matchAll(/<lsource([^>]*?)(?:\/>|>([\s\S]*?)<\/lsource>)/g)) {
    if (/ls_wasei="y"/.test(attributes)) wasei = true
    // Skip ls_type="part" partial-root origins (e.g. "sub" in サブリーダー) after recording ls_wasei="y".
    if (/ls_type="part"/.test(attributes)) continue
    const language = /xml:lang="([^"]+)"/.exec(attributes)?.[1] ?? "eng"
    const word = decodeText(text)
    origins.push({ language, word: word.length > 0 ? word : null })
  }
  return { origins, wasei }
}

const parseExamples = (block: string): Array<SeedExample> =>
  blocks(block, "example").flatMap((example) => {
    const sentence = (language: string) =>
      decodeText(new RegExp(`<ex_sent[^>]*xml:lang="${language}"[^>]*>([\\s\\S]*?)</ex_sent>`).exec(example)?.[1] ?? "")
    const ja = sentence("jpn")
    const en = sentence("eng")
    return ja.length > 0 && en.length > 0 ? [{ ja, en, source: "tatoeba" as const }] : []
  })

const parseSense = (block: string, previousPos: ReadonlyArray<string>): ImportSense => {
  const pos = elements(block, "pos")
  return {
    glosses: Array.from(block.matchAll(/<gloss(\s[^>]*)?>([\s\S]*?)<\/gloss>/g), (match) => ({
      text: decodeText(match[2]!),
      type: /g_type="([^"]+)"/.exec(match[1] ?? "")?.[1] ?? null
    })),
    // Per the JMdict DTD, a sense with no <pos> inherits the preceding sense's part of speech.
    pos: pos.length > 0 ? pos : previousPos,
    misc: elements(block, "misc"),
    fields: elements(block, "field"),
    dialects: elements(block, "dial"),
    info: elements(block, "s_inf"),
    stagk: elements(block, "stagk"),
    stagr: elements(block, "stagr"),
    xrefs: elements(block, "xref"),
    antonyms: elements(block, "ant"),
    ...parseOrigins(block),
    examples: parseExamples(block)
  }
}

const visible = (form: FormRecord) =>
  !form.tags.some((tag) => (form.kind === "kanji" ? HIDDEN_KANJI : HIDDEN_KANA).has(tag))

export const chooseHeadword = (forms: ReadonlyArray<FormRecord>, senses: ReadonlyArray<ImportSense>) => {
  const kanji = forms.filter((form) => form.kind === "kanji")
  const kana = forms.filter((form) => form.kind === "kana")
  const bestKanji = kanji.find((form) => visible(form) && form.common) ?? kanji.find(visible) ?? kanji[0]
  const readings = kana.filter(
    (form) =>
      bestKanji === undefined ||
      (!form.noKanji && (form.restrictions.length === 0 || form.restrictions.includes(bestKanji.text)))
  )
  const reading = (readings.find(visible) ?? readings[0] ?? kana[0])?.text ?? bestKanji?.text ?? ""
  const usuallyKana = senses[0]?.misc.includes("uk") ?? false
  const headword = bestKanji === undefined || usuallyKana ? reading : bestKanji.text
  return { headword, reading }
}

const frequencyOf = (forms: ReadonlyArray<FormRecord>): SeedFrequency => ({
  everyday: forms.some((form) => form.priorities.includes("ichi1")),
  spokenCount: null,
  score: null
})

export const parseEntry = (block: string): ImportEntry => {
  const forms = [...blocks(block, "k_ele").map(parseKanji), ...blocks(block, "r_ele").map(parseKana)]
  const senses: Array<ImportSense> = []
  for (const sense of blocks(block, "sense")) {
    senses.push(parseSense(sense, senses.at(-1)?.pos ?? []))
  }
  const { headword, reading } = chooseHeadword(forms, senses)
  return {
    id: EntryId.make(Number(first(block, "ent_seq"))),
    language: "ja",
    source: "jmdict",
    headword,
    reading,
    common: forms.some((form) => form.common),
    priority: Math.max(0, ...forms.map((form) => priorityScore(form.priorities))),
    forms,
    senses,
    frequency: frequencyOf(forms)
  }
}

export const entrySplitter = () => {
  let buffer = ""
  return (chunk: string): Array<ImportEntry> => {
    buffer += chunk
    const entries: Array<ImportEntry> = []
    let start = buffer.indexOf("<entry>")
    let end = start === -1 ? -1 : buffer.indexOf("</entry>", start)
    while (start !== -1 && end !== -1) {
      entries.push(parseEntry(buffer.slice(start + "<entry>".length, end)))
      start = buffer.indexOf("<entry>", end)
      end = start === -1 ? -1 : buffer.indexOf("</entry>", start)
    }
    // Retain a trailing slice in case "<entry>" was split across chunk boundaries.
    buffer = start === -1 ? buffer.slice(-"<entry>".length) : buffer.slice(start)
    return entries
  }
}

export function* parseEntries(xml: string): Generator<ImportEntry> {
  let cursor = xml.indexOf("<entry>")
  while (cursor !== -1) {
    const end = xml.indexOf("</entry>", cursor)
    if (end === -1) return
    yield parseEntry(xml.slice(cursor + "<entry>".length, end))
    cursor = xml.indexOf("<entry>", end)
  }
}
