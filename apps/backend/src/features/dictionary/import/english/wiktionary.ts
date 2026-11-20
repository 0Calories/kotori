import type { GlossRecord } from "@kotori/contracts"
import { type EnglishInflection, normalizeGloss } from "@kotori/language"
import { Option, Predicate, Schema } from "effect"
import type { ImportSense, SeedExample } from "../seedFacts.ts"
import { FIELDS, PARTS_OF_SPEECH, REGIONS, TRANSITIVITY, USAGE } from "./tags.ts"
import { leadingAside, splitDefinition } from "./text.ts"
import {
  addRedirect,
  emptySense,
  type FormOf,
  formOf,
  type InflectedForm,
  inflectionsNamed,
  isEnglish,
  parseConsolidatedLine,
  type References,
  type Word
} from "./words.ts"

export const WIKTIONARY_URL = "https://kaikki.org/jawiktionary/raw-wiktextract-data.jsonl.gz"

const Strings = Schema.optional(Schema.Array(Schema.String))
const WordRef = Schema.Struct({ word: Schema.optional(Schema.String) })
const WordRefs = Schema.optional(Schema.Array(WordRef))
// Wiktextract emits some word lists as a newline-delimited wiki table string instead of an array.
const WordList = Schema.optional(Schema.Union([Schema.Array(WordRef), Schema.String]))
const SenseLink = Schema.Union([Schema.Array(Schema.String), WordRef, Schema.String])

const RawForm = Schema.Struct({ form: Schema.optional(Schema.String), tags: Strings })
type RawForm = typeof RawForm.Type

const RawSense = Schema.Struct({
  glosses: Strings,
  tags: Strings,
  raw_tags: Strings,
  topics: Strings,
  form_of: WordRefs,
  alt_of: WordRefs,
  links: Schema.optional(Schema.Array(SenseLink)),
  examples: Schema.optional(
    Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String), translation: Schema.optional(Schema.String) }))
  )
})
type RawSense = typeof RawSense.Type

const RawEntry = Schema.Struct({
  word: Schema.optional(Schema.String),
  lang_code: Schema.optional(Schema.String),
  pos: Schema.optional(Schema.String),
  senses: Schema.optional(Schema.Array(RawSense)),
  forms: Schema.optional(Schema.Array(RawForm)),
  sounds: Schema.optional(Schema.Array(Schema.Struct({ ipa: Schema.optional(Schema.String), tags: Strings }))),
  synonyms: WordRefs,
  antonyms: WordRefs,
  derived: WordList,
  phrases: WordList,
  proverbs: WordList,
  related: WordList,
  collocations: WordList
})
type RawEntry = typeof RawEntry.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(RawEntry))

const isEnglishLine = (line: string) => line.includes('"lang_code": "en"') || line.includes('"lang_code":"en"')

const MAX_REFERENCES = 8

const words = (list: ReadonlyArray<typeof WordRef.Type> | undefined) =>
  (list ?? [])
    .map((item) => item.word?.trim() ?? "")
    .filter((word) => word.length > 0 && isEnglish(word))
    .slice(0, MAX_REFERENCES)

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

const classify = (labels: ReadonlyArray<string>, into: Labels) => {
  const filed = labels.map((label) => {
    const match = LABELS.find(([table]) => table[label] !== undefined)
    return match === undefined ? null : ([match[1], match[0][label]!] as const)
  })
  if (filed.some((entry) => entry === null)) return false
  for (const [key, code] of filed as ReadonlyArray<readonly [keyof Labels, string]>) into[key].push(code)
  return true
}

const classifyKnown = (labels: ReadonlyArray<string>, into: Labels) => {
  for (const label of labels) classify([label], into)
}

const unique = <A>(items: ReadonlyArray<A>) => [...new Set(items)]

const STANDALONE_FORM_TAGS = new Set(["abbreviation", "acronym", "initialism", "clipping", "contraction", "ellipsis"])

const readExamples = (raw: RawSense): Array<SeedExample> =>
  (raw.examples ?? []).flatMap((example) => {
    const en = example.text?.trim() ?? ""
    const ja = example.translation?.trim() ?? ""
    return en.length > 0 && ja.length > 0 ? [{ ja, en, source: "jawiktionary" as const }] : []
  })

const readSense = (
  raw: RawSense,
  word: string,
  pos: string | undefined
): { readonly sense: ImportSense | null; readonly formsOf: ReadonlyArray<FormOf> } => {
  const bases = (raw.form_of ?? []).map((target) => target.word?.trim() ?? "").filter((base) => base.length > 0)
  const isStandalone = raw.tags?.some((tag) => STANDALONE_FORM_TAGS.has(tag)) ?? false
  if ((bases.length > 0 || raw.tags?.includes("form-of")) && !isStandalone) {
    const tags = inflectionsNamed((raw.glosses ?? []).join(" "))
    return { sense: null, formsOf: bases.filter((base) => base !== word).map((base) => ({ text: word, base, tags })) }
  }
  const labels: Labels = { pos: pos === undefined ? [] : [pos], misc: [], fields: [], dialects: [] }
  classifyKnown(raw.tags ?? [], labels)
  classifyKnown(raw.raw_tags ?? [], labels)
  classifyKnown(raw.topics ?? [], labels)

  const formsOf: Array<FormOf> = []
  const glosses: Array<GlossRecord> = []
  const info: Array<string> = []
  for (const definition of raw.glosses ?? []) {
    let text = definition.trim()
    for (let lead = leadingAside(text); lead !== null; lead = leadingAside(text)) {
      // Split combined Japanese region+register shorthands like "(米話)" into ["米", "話"].
      const named = lead.aside
        .split(/[・、,\s]+/)
        .flatMap((label) => (/^[米英豪][話俗古]$/.test(label) ? label.split("") : [label]))
      if (!classify(named, labels)) break
      text = lead.rest
    }
    // Japanese Wiktionary often writes inflection redirects as prose glosses ("getの過去分詞") without form_of tags.
    const form = formOf(text)
    if (form !== null) {
      if (form.base !== word) formsOf.push({ text: word, ...form })
      continue
    }
    const { glosses: split, notes } = splitDefinition(text)
    glosses.push(...split.map((gloss) => ({ text: gloss, type: null })))
    info.push(...notes)
  }
  if (glosses.length === 0) return { sense: null, formsOf }
  // Particle-suffixed raw_tags ("犬などを", "ピッチャーが") express argument context rather than register labels.
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
      info: unique(info),
      examples: readExamples(raw)
    },
    formsOf
  }
}

const INFLECTION_TAGS: ReadonlyArray<readonly [ReadonlyArray<string>, EnglishInflection]> = [
  [["third-person"], "third-person"],
  [["present", "participle"], "present-participle"],
  [["past", "participle"], "past-participle"],
  [["past"], "past"],
  [["plural"], "plural"],
  [["comparative"], "comparative"],
  [["superlative"], "superlative"]
]

const byEnding = (word: string, form: string): EnglishInflection | null => {
  const stem = word.replace(/e$/, "").replace(/y$/, "i")
  if (!form.startsWith(stem.slice(0, Math.max(1, stem.length - 1)))) return null
  if (form.endsWith("est")) return "superlative"
  if (form.endsWith("er")) return "comparative"
  return null
}

const QUIET_SPELLINGS = new Set(["obsolete", "archaic", "rare", "dialectal", "uncommon", "nonstandard", "slang"])

const readForms = (word: string, raw: ReadonlyArray<RawForm>) => {
  const inflections: Array<InflectedForm> = []
  const spellings: Array<string> = []
  for (const { form, tags = [] } of raw) {
    const text = form?.trim() ?? ""
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
  // Wiktextract often tags regular "-ed" forms only as past-participle, omitting past.
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

// Reject unparsed Wiktionary template remnants ("en", "lang=en", "list") emitted in sound.ipa.
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

const readIpa = (sounds: RawEntry["sounds"]): string | null => {
  const ipas = (sounds ?? []).flatMap((sound) => {
    const ipa = sound.ipa === undefined || sound.tags?.includes("X-SAMPA") ? null : cleanIpa(sound.ipa)
    return ipa === null ? [] : [{ ipa, tags: sound.tags ?? [] }]
  })
  const american = ipas.find((sound) => sound.tags.some((tag) => /US|General-American|GA|米/.test(tag)))
  return (american ?? ipas[0])?.ipa ?? null
}

const listedWords = (list: typeof WordList.Type): Array<string> => {
  if (list === undefined) return []
  return Predicate.isString(list) ? list.split("\n").slice(1) : list.map((item) => item.word ?? "")
}

const linkWords = (links: ReadonlyArray<typeof SenseLink.Type> | undefined): Array<string> =>
  (links ?? []).map((link) =>
    Predicate.isString(link) ? link : "length" in link ? (link[1] ?? link[0] ?? "") : (link.word ?? "")
  )

const isPhrase = (phrase: string) =>
  phrase.includes(" ") &&
  isEnglish(phrase) &&
  normalizeGloss(phrase).includes(" ") &&
  !phrase
    .split(" ")
    .slice(1)
    .some((word) => /^[A-Z]/.test(word) && !/^I(?:$|[’'])/.test(word))

const readPhrases = (entry: RawEntry): Array<string> => {
  if (entry.pos === "name") return []
  const senseRefs = (entry.senses ?? []).flatMap((sense) => [
    ...listedWords(sense.form_of),
    ...listedWords(sense.alt_of),
    ...linkWords(sense.links)
  ])
  return [
    ...listedWords(entry.derived),
    ...listedWords(entry.phrases),
    ...listedWords(entry.proverbs),
    ...listedWords(entry.related),
    ...listedWords(entry.collocations),
    ...listedWords(entry.synonyms),
    ...listedWords(entry.antonyms),
    ...senseRefs
  ]
    .map((phrase) => phrase.trim())
    .filter(isPhrase)
    .map((phrase) => phrase.toLowerCase())
}

interface Builder {
  ipa: string | null
  spellings: Array<string>
  inflections: Array<InflectedForm>
  senses: Array<ImportSense>
  references: Array<References>
}

export const wiktionaryParser = () => {
  const builders = new Map<string, Builder>()
  const formsOf: Array<FormOf> = []
  const phrases = new Set<string>()

  const add = (line: string) => {
    if (!isEnglishLine(line)) return
    const decoded = decodeLine(line)
    if (Option.isNone(decoded)) return
    const entry = decoded.value
    const word = entry.word?.trim() ?? ""
    if (entry.lang_code !== "en" || word.length === 0 || !isEnglish(word)) return
    for (const phrase of readPhrases(entry)) phrases.add(phrase)

    const pos = entry.pos === undefined ? undefined : PARTS_OF_SPEECH[entry.pos]
    const senses: Array<ImportSense> = []
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
    // Wiktextract attaches synonyms and antonyms to the POS entry rather than individual senses.
    const synonyms = words(entry.synonyms)
    const antonyms = words(entry.antonyms)
    if (synonyms.length + antonyms.length > 0) {
      const from = builder.senses.length
      builder.references.push({ from, to: from + senses.length, synonyms, antonyms })
    }
    builder.senses.push(...senses)
  }

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

export const parseWiktionary = (lines: Iterable<string>) => {
  const parser = wiktionaryParser()
  for (const line of lines) parser.add(line)
  return parser.finish()
}

const mergeInflections = (forms: ReadonlyArray<InflectedForm>): Array<InflectedForm> => {
  const merged = new Map<string, Set<EnglishInflection>>()
  for (const form of forms) {
    const tags = merged.get(form.text) ?? new Set<EnglishInflection>()
    for (const tag of form.tags) tags.add(tag)
    merged.set(form.text, tags)
  }
  return [...merged].map(([text, tags]) => ({ text, tags: [...tags] }))
}

export const curatedParser = () => {
  const byHeadword = new Map<string, Word>()
  const add = (line: string) => {
    const word = parseConsolidatedLine(line)
    if (word !== null && isEnglish(word.headword) && word.senses.length > 0) {
      byHeadword.set(word.headword, word)
    }
  }
  const finish = () => ({
    words: [...byHeadword.values()],
    formsOf: [] as Array<FormOf>
  })
  return { add, finish }
}

export const parseCurated = (lines: Iterable<string>) => {
  const parser = curatedParser()
  for (const line of lines) parser.add(line)
  return parser.finish()
}

const PhraseIndexSchema = Schema.Struct({
  phrases: Schema.optional(Schema.Array(Schema.String)),
  redirects: Schema.optional(Schema.Record(Schema.String, Schema.String))
})

const decodePhraseIndex = Schema.decodeUnknownOption(Schema.fromJsonString(PhraseIndexSchema))

export const parsePhraseIndex = (
  json: string
): { readonly phrases: Set<string>; readonly redirects: Map<string, string> } => {
  const phrases = new Set<string>()
  const redirects = new Map<string, string>()
  const decoded = decodePhraseIndex(json)
  if (Option.isNone(decoded)) return { phrases, redirects }
  for (const phrase of decoded.value.phrases ?? []) {
    const clean = phrase.trim().toLowerCase()
    if (clean.includes(" ") && isEnglish(clean) && normalizeGloss(clean).includes(" ")) {
      phrases.add(clean)
    }
  }
  for (const [variant, target] of Object.entries(decoded.value.redirects ?? {})) {
    if (addRedirect(redirects, variant, target)) phrases.add(target.trim().toLowerCase())
  }
  return { phrases, redirects }
}
