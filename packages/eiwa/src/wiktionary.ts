import type { GlossRecord, SenseRecord } from "@kotori/db"
import { splitDefinition, leadingAside } from "./text.ts"
import { FIELDS, type Inflection, PARTS_OF_SPEECH, REGIONS, TRANSITIVITY, USAGE } from "./tags.ts"
import {
  emptySense,
  type FormOf,
  formOf,
  type InflectedForm,
  inflectionsNamed,
  isEnglish,
  type References,
  type Word
} from "./words.ts"

/**
 * Reads the English entries of Japanese Wiktionary (ja.wiktionary.org) as Wiktextract
 * extracts them for kaikki.org: one JSON object per word and part of speech, with
 * definitions written in Japanese. Licensed CC BY-SA 4.0, like JMDict.
 */

/** Wiktextract's extraction of every language in Japanese Wiktionary, refreshed weekly. */
export const WIKTIONARY_URL = "https://kaikki.org/jawiktionary/raw-wiktextract-data.jsonl.gz"

// Only the fields read here; anything else in the extraction is ignored.
interface RawForm {
  readonly form?: string
  readonly tags?: ReadonlyArray<string>
}
interface RawSense {
  readonly glosses?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly raw_tags?: ReadonlyArray<string>
  readonly topics?: ReadonlyArray<string>
  readonly form_of?: ReadonlyArray<{ readonly word?: string }>
}
interface RawEntry {
  readonly word?: string
  readonly lang_code?: string
  readonly pos?: string
  readonly senses?: ReadonlyArray<RawSense>
  readonly forms?: ReadonlyArray<RawForm>
  readonly sounds?: ReadonlyArray<{ readonly ipa?: string; readonly tags?: ReadonlyArray<string> }>
  readonly synonyms?: ReadonlyArray<{ readonly word?: string }>
  readonly antonyms?: ReadonlyArray<{ readonly word?: string }>
  readonly derived?: unknown
  readonly phrases?: ReadonlyArray<{ readonly word?: string }>
}

/** Whether a line of the extraction is about an English word, checked before paying to parse it. */
const isEnglishLine = (line: string) => line.includes('"lang_code": "en"') || line.includes('"lang_code":"en"')

/** The most synonyms or antonyms kept as cross-references; the first are the closest. */
const MAX_REFERENCES = 8

const words = (list: ReadonlyArray<{ readonly word?: string }> | undefined) =>
  (list ?? [])
    .map((item) => item.word?.trim() ?? "")
    .filter((word) => word.length > 0 && isEnglish(word))
    .slice(0, MAX_REFERENCES)

/** A sense's tags as they are gathered, before the sense is built. */
interface Labels {
  readonly pos: Array<string>
  readonly misc: Array<string>
  readonly fields: Array<string>
  readonly dialects: Array<string>
}

const LABELS: ReadonlyArray<readonly [Readonly<Record<string, string>>, keyof Labels]> = [
  [USAGE, "misc"],
  [REGIONS, "dialects"],
  [FIELDS, "fields"],
  [TRANSITIVITY, "pos"]
]

const isLabel = (label: string) => LABELS.some(([table]) => table[label] !== undefined)

/**
 * Files usage notes, regions, fields and transitivity, wherever they appear: tags, raw
 * tags, topics, or labels in a gloss. Returns false, filing nothing, if any label is unknown.
 */
const classify = (labels: ReadonlyArray<string>, into: Labels) => {
  const filed = labels.map((label) => {
    const match = LABELS.find(([table]) => table[label] !== undefined)
    return match === undefined ? null : ([match[1], match[0][label]!] as const)
  })
  if (filed.some((entry) => entry === null)) return false
  for (const [key, code] of filed as ReadonlyArray<readonly [keyof Labels, string]>) into[key].push(code)
  return true
}

/** Like `classify`, but files what it knows and skips the rest, for tags that aren't all labels. */
const classifyKnown = (labels: ReadonlyArray<string>, into: Labels) => {
  for (const label of labels) classify([label], into)
}

const unique = <A>(items: ReadonlyArray<A>) => [...new Set(items)]

/**
 * One sense, and the forms it points at when it says "the past tense of …", which are
 * forms of that word rather than meanings: "ate" is no word of its own but eat's past,
 * as 食べた is 食べる's. Leading labels such as "(米話)" or "(他動詞)" become tags; asides
 * that describe the use, such as "(人を)", stay in the gloss as JMDict's English glosses
 * keep "(of a person)".
 */
const readSense = (
  raw: RawSense,
  word: string,
  pos: string | undefined
): { readonly sense: SenseRecord | null; readonly formsOf: ReadonlyArray<FormOf> } => {
  const bases = (raw.form_of ?? []).map((target) => target.word?.trim() ?? "").filter((base) => base.length > 0)
  if (bases.length > 0 || raw.tags?.includes("form-of")) {
    const tags = inflectionsNamed((raw.glosses ?? []).join(" "))
    return { sense: null, formsOf: bases.filter((base) => base !== word).map((base) => ({ text: word, base, tags })) }
  }
  // Pages for inflections often say so in the definition itself, untagged: "eatの過去形".
  const formsOf: Array<FormOf> = []
  const definitions = (raw.glosses ?? []).filter((definition) => {
    const form = formOf(definition)
    if (form !== null && form.base !== word) formsOf.push({ text: word, ...form })
    return form === null
  })

  const labels: Labels = { pos: pos === undefined ? [] : [pos], misc: [], fields: [], dialects: [] }
  classifyKnown(raw.tags ?? [], labels)
  classifyKnown(raw.raw_tags ?? [], labels)
  classifyKnown(raw.topics ?? [], labels)

  const glosses: Array<GlossRecord> = []
  const info: Array<string> = []
  for (const definition of definitions) {
    let text = definition.trim()
    for (let lead = leadingAside(text); lead !== null; lead = leadingAside(text)) {
      // "(米話)" is two labels written together: 米 and 話.
      const named = lead.aside
        .split(/[・、,\s]+/)
        .flatMap((label) => (/^[米英豪][話俗古]$/.test(label) ? label.split("") : [label]))
      if (!classify(named, labels)) break
      text = lead.rest
    }
    const { glosses: split, notes } = splitDefinition(text)
    glosses.push(...split.map((gloss) => ({ text: gloss, type: null })))
    info.push(...notes)
  }
  if (glosses.length === 0) return { sense: null, formsOf }
  // Labels such as "犬などを" or "ピッチャーが" say what the word acts on or who does it: the
  // context JMDict writes as "(of a dog)", so they lead the first gloss the same way.
  const context = (raw.raw_tags ?? []).filter((tag) => /[をがにでとの]$/.test(tag) && !isLabel(tag))
  if (context.length > 0) glosses[0] = { text: `（${context.join("・")}）${glosses[0]!.text}`, type: null }
  return {
    sense: {
      ...emptySense(),
      glosses,
      pos: unique(labels.pos),
      misc: unique(labels.misc),
      fields: unique(labels.fields),
      dialects: unique(labels.dialects),
      info: unique(info)
    },
    formsOf
  }
}

const INFLECTION_TAGS: ReadonlyArray<readonly [ReadonlyArray<string>, Inflection]> = [
  [["third-person"], "third-person"],
  [["present", "participle"], "present-participle"],
  [["past", "participle"], "past-participle"],
  [["past"], "past"],
  [["plural"], "plural"],
  [["comparative"], "comparative"],
  [["superlative"], "superlative"]
]

/** "bluer" and "bluest" come untagged; their endings say what they are. */
const byEnding = (word: string, form: string): Inflection | null => {
  const stem = word.replace(/e$/, "").replace(/y$/, "i")
  if (!form.startsWith(stem.slice(0, Math.max(1, stem.length - 1)))) return null
  if (form.endsWith("est")) return "superlative"
  if (form.endsWith("er")) return "comparative"
  return null
}

/** Spellings that are only historical or rare would clutter "also written". */
const QUIET_SPELLINGS = new Set(["obsolete", "archaic", "rare", "dialectal", "uncommon", "nonstandard", "slang"])

const readForms = (word: string, raw: ReadonlyArray<RawForm>) => {
  const inflections: Array<InflectedForm> = []
  const spellings: Array<string> = []
  for (const { form, tags = [] } of raw) {
    const text = form?.trim() ?? ""
    // Phrases ("more awkward") and anything not written in English ("または") aren't forms to look up.
    if (text.length === 0 || text === word || text.includes(" ") || !isEnglish(text)) continue
    if (tags.includes("canonical")) continue
    if (tags.includes("alternative")) {
      if (!tags.some((tag) => QUIET_SPELLINGS.has(tag))) spellings.push(text)
      continue
    }
    const named = INFLECTION_TAGS.find(([required]) => required.every((tag) => tags.includes(tag)))?.[1]
    const inflection = named ?? (tags.length === 0 ? byEnding(word, text) : null)
    if (inflection !== null) inflections.push({ text, tags: [inflection] })
  }
  // A regular verb's "walked" is listed once, as the past participle, but is the past tense too.
  if (!inflections.some((form) => form.tags.includes("past"))) {
    return {
      spellings,
      inflections: inflections.map((form) =>
        form.tags.includes("past-participle") ? { text: form.text, tags: ["past", "past-participle"] as const } : form
      )
    }
  }
  return { spellings, inflections }
}

/**
 * A transcription as it should be shown, or null for template debris the extraction keeps
 * as IPA ("/en/", "/lang-en/", "[list]"): one pair of slashes, and ' written as the stress mark.
 */
export const cleanIpa = (raw: string): string | null => {
  const bracket = raw.trim().startsWith("[") ? ["[", "]"] : ["/", "/"]
  const inner = raw
    .trim()
    .replace(/^[/[]+|[/\]]+$/g, "")
    .replace(/'/g, "ˈ")
    .trim()
  if (inner.length === 0 || /^(en|lang.*|list|ipa)$/i.test(inner)) return null
  return `${bracket[0]}${inner}${bracket[1]}`
}

/** The first usable IPA transcription, preferring American, which is what the default voices speak. */
const readIpa = (sounds: RawEntry["sounds"]): string | null => {
  const ipas = (sounds ?? []).flatMap((sound) => {
    const ipa = sound.ipa === undefined || sound.tags?.includes("X-SAMPA") ? null : cleanIpa(sound.ipa)
    return ipa === null ? [] : [{ ipa, tags: sound.tags ?? [] }]
  })
  const american = ipas.find((sound) => sound.tags.some((tag) => /US|General-American|GA|米/.test(tag)))
  return (american ?? ipas[0])?.ipa ?? null
}

/** Phrases Wiktionary lists under a word, which attest them as English even without an entry of their own. */
const readPhrases = (entry: RawEntry): Array<string> => {
  const derived = entry.derived
  const listed = Array.isArray(derived)
    ? derived.map((item: { readonly word?: string }) => item.word ?? "")
    : // Some pages hold the list as a table: a header line, then one word per line.
      typeof derived === "string"
      ? derived.split("\n").slice(1)
      : []
  return [...listed, ...(entry.phrases ?? []).map((item) => item.word ?? "")]
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.includes(" ") && isEnglish(phrase))
}

interface Builder {
  ipa: string | null
  spellings: Array<string>
  inflections: Array<InflectedForm>
  senses: Array<SenseRecord>
  references: Array<References>
}

/**
 * Reads the extraction a line at a time, so a line can go as soon as it is read: each holds
 * on to the chunk of the file it was cut from, and most of the file is other languages.
 */
export const wiktionaryParser = () => {
  const builders = new Map<string, Builder>()
  const formsOf: Array<FormOf> = []
  const phrases = new Set<string>()

  const add = (line: string) => {
    if (!isEnglishLine(line)) return
    let entry: RawEntry
    try {
      entry = JSON.parse(line) as RawEntry
    } catch {
      return
    }
    const word = entry.word?.trim() ?? ""
    if (entry.lang_code !== "en" || word.length === 0 || !isEnglish(word)) return
    for (const phrase of readPhrases(entry)) phrases.add(phrase.toLowerCase())

    const pos = entry.pos === undefined ? undefined : PARTS_OF_SPEECH[entry.pos]
    const senses: Array<SenseRecord> = []
    for (const raw of entry.senses ?? []) {
      const read = readSense(raw, word, pos)
      formsOf.push(...read.formsOf)
      if (read.sense !== null) {
        const extra = entry.pos === "abbrev" ? ["abbr"] : entry.pos === "proverb" ? ["proverb"] : []
        senses.push(extra.length === 0 ? read.sense : { ...read.sense, misc: unique([...read.sense.misc, ...extra]) })
      }
    }
    if (senses.length === 0) return

    const builder = builders.get(word) ?? { ipa: null, spellings: [], inflections: [], senses: [], references: [] }
    builders.set(word, builder)
    builder.ipa ??= readIpa(entry.sounds)
    const forms = readForms(word, entry.forms ?? [])
    builder.spellings.push(...forms.spellings)
    builder.inflections.push(...forms.inflections)
    // Synonyms and antonyms are listed for the whole part of speech, not for one of its senses.
    const synonyms = words(entry.synonyms)
    const antonyms = words(entry.antonyms)
    if (synonyms.length + antonyms.length > 0) {
      const from = builder.senses.length
      builder.references.push({ from, to: from + senses.length, synonyms, antonyms })
    }
    builder.senses.push(...senses)
  }

  /** Every English word read, its parts of speech merged into one headword, in page order. */
  const finish = () => ({
    words: [...builders].map(([headword, builder]): Word => ({
      headword,
      ipa: builder.ipa,
      spellings: unique(builder.spellings),
      inflections: mergeInflections(builder.inflections),
      senses: builder.senses,
      references: builder.references
    })),
    formsOf,
    phrases
  })

  return { add, finish }
}

/** Every English word in the extraction's lines; see `wiktionaryParser`. */
export const parseWiktionary = (lines: Iterable<string>) => {
  const parser = wiktionaryParser()
  for (const line of lines) parser.add(line)
  return parser.finish()
}

/** One form per spelling, with every inflection it is: "read" is both past and past participle. */
const mergeInflections = (forms: ReadonlyArray<InflectedForm>): Array<InflectedForm> => {
  const merged = new Map<string, Set<Inflection>>()
  for (const form of forms) {
    const tags = merged.get(form.text) ?? new Set<Inflection>()
    for (const tag of form.tags) tags.add(tag)
    merged.set(form.text, tags)
  }
  return [...merged].map(([text, tags]) => ({ text, tags: [...tags] }))
}
