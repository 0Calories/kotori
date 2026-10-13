import type { EntryRecord, FormRecord, SenseRecord } from "@kotori/db"

/**
 * A streaming-friendly parser for EDRDG's JMdict XML.
 *
 * JMDict's markup is small and regular, so entries are cut out with indexOf and
 * read with targeted regexes rather than a general XML parser. Tag codes are
 * declared as DTD entities (`<!ENTITY v1 "Ichidan verb">`); references like
 * `&v1;` are kept as their code and the declarations become the tag table.
 */

export interface JMDictTag {
  readonly code: string
  readonly label: string
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" }

const decodeText = (raw: string) =>
  raw.replace(/&([\w-]+);/g, (whole, name: string) => XML_ENTITIES[name] ?? name).trim()

const ENTITY_DECLARATION = /<!ENTITY\s+([\w-]+)\s+"([^"]*)">/g

/** Tag codes and descriptions declared in the DTD. */
export const parseTags = (xml: string): Array<JMDictTag> => {
  const end = xml.indexOf("]>")
  const dtd = end === -1 ? "" : xml.slice(0, end)
  // A few codes are declared more than once; the first declaration wins.
  const tags = new Map<string, string>()
  for (const [, code, label] of dtd.matchAll(ENTITY_DECLARATION)) {
    if (!tags.has(code!)) tags.set(code!, label!)
  }
  return Array.from(tags, ([code, label]) => ({ code, label }))
}

const elements = (block: string, name: string): Array<string> =>
  Array.from(block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g")), (match) => decodeText(match[1]!))

const first = (block: string, name: string) => elements(block, name)[0]

const blocks = (block: string, name: string): Array<string> =>
  Array.from(block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g")), (match) => match[1]!)

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

const COMMON_MARKERS = new Set(["news1", "ichi1", "spec1", "spec2", "gai1"])

/** ichi1 (the "Ichimango" basic vocabulary list) says more about everyday use than newspaper counts. */
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

/**
 * Folds a form's JMDict frequency markers into one score. nfXX ranks newspaper
 * frequency in bands of 500 words (nf01 = most frequent).
 */
export const priorityScore = (priorities: ReadonlyArray<string>) =>
  Math.round(priorities.reduce((score, marker) => {
    const band = /^nf(\d\d)$/.exec(marker)
    if (band) return score + (49 - Number(band[1])) * 1.5
    return score + (MARKER_WEIGHT[marker] ?? 0)
  }, 0))

export const isCommon = (priorities: ReadonlyArray<string>) => priorities.some((marker) => COMMON_MARKERS.has(marker))

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** Forms that exist for search only, or that learners shouldn't be shown first. Ateji (寿司) are often the standard spelling, so they stay. */
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

const parseSense = (block: string, previousPos: ReadonlyArray<string>): SenseRecord => {
  const pos = elements(block, "pos")
  return {
    glosses: Array.from(block.matchAll(/<gloss(\s[^>]*)?>([\s\S]*?)<\/gloss>/g), (match) => ({
      text: decodeText(match[2]!),
      type: /g_type="([^"]+)"/.exec(match[1] ?? "")?.[1] ?? null
    })),
    // "The part-of-speech of an earlier sense will apply to later senses unless
    // there is a new part-of-speech indicated." (JMdict DTD)
    pos: pos.length > 0 ? pos : previousPos,
    misc: elements(block, "misc"),
    fields: elements(block, "field"),
    dialects: elements(block, "dial"),
    info: elements(block, "s_inf"),
    stagk: elements(block, "stagk"),
    stagr: elements(block, "stagr"),
    xrefs: elements(block, "xref"),
    antonyms: elements(block, "ant")
  }
}

const visible = (form: FormRecord) =>
  !form.tags.some((tag) => (form.kind === "kanji" ? HIDDEN_KANJI : HIDDEN_KANA).has(tag))

/** Picks the forms to show first: kana for words usually written in kana, else the best kanji form. */
export const chooseHeadword = (forms: ReadonlyArray<FormRecord>, senses: ReadonlyArray<SenseRecord>) => {
  const kanji = forms.filter((form) => form.kind === "kanji")
  const kana = forms.filter((form) => form.kind === "kana")
  const bestKanji = kanji.find((form) => visible(form) && form.common) ?? kanji.find(visible) ?? kanji[0]
  const readings = kana.filter((form) =>
    bestKanji === undefined || (!form.noKanji && (form.restrictions.length === 0 || form.restrictions.includes(bestKanji.text)))
  )
  const reading = (readings.find(visible) ?? readings[0] ?? kana[0])?.text ?? bestKanji?.text ?? ""
  const usuallyKana = senses[0]?.misc.includes("uk") ?? false
  const headword = bestKanji === undefined || usuallyKana ? reading : bestKanji.text
  return { headword, reading }
}

export const parseEntry = (block: string): EntryRecord => {
  const forms = [...blocks(block, "k_ele").map(parseKanji), ...blocks(block, "r_ele").map(parseKana)]
  const senses: Array<SenseRecord> = []
  for (const sense of blocks(block, "sense")) {
    senses.push(parseSense(sense, senses.at(-1)?.pos ?? []))
  }
  const { headword, reading } = chooseHeadword(forms, senses)
  return {
    id: Number(first(block, "ent_seq")),
    headword,
    reading,
    common: forms.some((form) => form.common),
    priority: Math.max(0, ...forms.map((form) => priorityScore(form.priorities))),
    forms,
    senses
  }
}

/** Lazily yields every entry in a JMdict XML document. */
export function* parseEntries(xml: string): Generator<EntryRecord> {
  let cursor = xml.indexOf("<entry>")
  while (cursor !== -1) {
    const end = xml.indexOf("</entry>", cursor)
    if (end === -1) return
    yield parseEntry(xml.slice(cursor + "<entry>".length, end))
    cursor = xml.indexOf("<entry>", end)
  }
}
