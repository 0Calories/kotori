import type { EnglishInflection } from "@kotori/language"
import { Option, Predicate, Schema } from "effect"
import { FIELDS, PARTS_OF_SPEECH, REGIONS, TRANSITIVITY, USAGE } from "./tags.ts"
import {
  type FormOf,
  type InflectedForm,
  isEnglish,
  parseConsolidatedLine,
  type Word
} from "./words.ts"

/**
 * Reads English Wiktionary (en.wiktionary.org) as Wiktextract extracts it for kaikki.org,
 * and reads the consolidated Japanese-glossed entries built from it (`enwiktionary-ja.jsonl`).
 * Licensed CC BY-SA 4.0, like JMDict.
 */

/** Wiktextract's full English Wiktionary extraction on kaikki.org, refreshed weekly. */
export const ENWIKTIONARY_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"

/**
 * Kaikki's per-headword JSONL URL for an English word or phrase (`keep it real`, `twerk`, `GOAT`).
 */
export const kaikkiWordUrl = (word: string): string => {
  const safe = word.replace(/ /g, "%20")
  const p1 = safe.slice(0, 1)
  const p2 = safe.length >= 2 ? safe.slice(0, 2) : `${p1}_`
  return `https://kaikki.org/dictionary/English/meaning/${p1}/${p2}/${safe}.jsonl`
}

const Strings = Schema.optional(Schema.Array(Schema.String))
const WordRef = Schema.Struct({ word: Schema.optional(Schema.String) })
const WordRefs = Schema.optional(Schema.Array(WordRef))

const RawForm = Schema.Struct({ form: Schema.optional(Schema.String), tags: Strings })
type RawForm = typeof RawForm.Type

const RawTranslation = Schema.Struct({
  code: Schema.optional(Schema.String),
  word: Schema.optional(Schema.String),
  sense: Schema.optional(Schema.String)
})

const RawExample = Schema.Struct({
  text: Schema.optional(Schema.String)
})

const RawSense = Schema.Struct({
  glosses: Strings,
  tags: Strings,
  raw_tags: Strings,
  topics: Strings,
  form_of: WordRefs,
  alt_of: WordRefs,
  synonyms: WordRefs,
  antonyms: WordRefs,
  translations: Schema.optional(Schema.Array(RawTranslation)),
  examples: Schema.optional(Schema.Array(RawExample))
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
  translations: Schema.optional(Schema.Array(RawTranslation)),
  derived: Schema.optional(Schema.Union([Schema.Array(WordRef), Schema.String])),
  phrases: WordRefs
})
type RawEntry = typeof RawEntry.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(RawEntry))

const isEnglishLine = (line: string) => line.includes('"lang_code": "en"') || line.includes('"lang_code":"en"')

const MAX_REFERENCES = 6

const words = (list: ReadonlyArray<typeof WordRef.Type> | undefined) =>
  (list ?? [])
    .map((item) => item.word?.trim() ?? "")
    .filter((word) => word.length > 0 && isEnglish(word))
    .slice(0, MAX_REFERENCES)

const unique = <A>(items: Iterable<A>): Array<A> => [...new Set(items)]

/** One raw English sense from enwiktionary before consolidation into learner senses. */
export interface RawEnSense {
  readonly index: number
  readonly pos: ReadonlyArray<string>
  readonly glosses: ReadonlyArray<string>
  readonly misc: ReadonlyArray<string>
  readonly dialects: ReadonlyArray<string>
  readonly fields: ReadonlyArray<string>
  readonly synonyms: ReadonlyArray<string>
  readonly antonyms: ReadonlyArray<string>
  readonly examples: ReadonlyArray<string>
  readonly jaTranslations: ReadonlyArray<string>
}

/** One English headword and all of its raw senses extracted from enwiktionary. */
export interface RawEnWord {
  readonly headword: string
  readonly ipa: string | null
  readonly spellings: ReadonlyArray<string>
  readonly inflections: ReadonlyArray<InflectedForm>
  readonly senses: ReadonlyArray<RawEnSense>
  readonly entryJaTranslations: ReadonlyArray<string>
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

/** "bluer" and "bluest" come untagged; their endings say what they are. */
const byEnding = (word: string, form: string): EnglishInflection | null => {
  const stem = word.replace(/e$/, "").replace(/y$/, "i")
  if (!form.startsWith(stem.slice(0, Math.max(1, stem.length - 1)))) return null
  if (form.endsWith("est")) return "superlative"
  if (form.endsWith("er")) return "comparative"
  return null
}

/**
 * Forms that are only historical, dialectal, or nonstandard ("yslain", "hullo") would clutter
 * a learner dictionary; slang inflections ("slayed", "goated") are kept on inflected forms.
 */
const QUIET_FORMS = new Set([
  "obsolete",
  "archaic",
  "rare",
  "dialectal",
  "uncommon",
  "nonstandard",
  "eye-dialect",
  "pronunciation-spelling"
])

const stripPunct = (s: string) => s.replace(/[-.']/g, "")

/**
 * In enwiktionary, `forms` tagged `"alternative"` come from `===Alternative forms===`, which
 * mixes hyphenation/punctuation variants ("side-walk", "re-form", "G.O.A.T.", "O.K.") with
 * untagged Middle English, Scots, and eye-dialect spellings ("tyebble", "freind", "ghoast").
 * Word-level spelling redirects ("judgement" -> "judgment", "colour" -> "color") come from
 * `alt-of` entries via `formsOf`, so `readForms` only keeps punctuation/hyphenation variants and
 * lowercase forms of all-caps acronyms ("ok" for "OK").
 */
const isCleanAlternativeForm = (word: string, text: string) => {
  const base = stripPunct(word)
  const candidate = stripPunct(text)
  if (base.toLowerCase() !== candidate.toLowerCase()) return false
  if (base.length !== word.length || candidate.length !== text.length) return true
  return word === word.toUpperCase() && text === text.toLowerCase()
}

/**
 * Reads forms from an enwiktionary entry, keeping multi-word inflections on multi-word
 * verb phrases ("keeps it real", "kept it real", "hung out") while skipping periphrastic
 * "more ..." / "most ..." forms, archaic/obsolete forms ("yslain"), and table metadata.
 */
export const readForms = (word: string, raw: ReadonlyArray<RawForm>) => {
  const isPhrase = word.includes(" ")
  const inflections: Array<InflectedForm> = []
  const spellings: Array<string> = []
  for (const { form, tags = [] } of raw) {
    const text = form?.trim() ?? ""
    if (text.length === 0 || text === word || !isEnglish(text)) continue
    if (tags.includes("table-tags") || tags.includes("inflection-template") || tags.includes("canonical")) continue
    if (tags.some((tag) => QUIET_FORMS.has(tag))) continue
    if (/^(more|most|further|furthest)\s+/i.test(text)) continue
    if (!isPhrase && text.includes(" ")) continue
    if (tags.includes("alternative")) {
      if (!tags.includes("slang") && isCleanAlternativeForm(word, text)) spellings.push(text)
      continue
    }
    const named = INFLECTION_TAGS.find(([required]) => required.every((tag) => tags.includes(tag)))?.[1]
    const inflection = named ?? (tags.length === 0 && !isPhrase ? byEnding(word, text) : null)
    if (inflection !== null) {
      const formTags: ReadonlyArray<EnglishInflection> =
        inflection === "past-participle" && text.endsWith("ed") ? ["past", "past-participle"] : [inflection]
      inflections.push({ text, tags: formTags })
    }
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
export const readIpa = (sounds: RawEntry["sounds"]): string | null => {
  const ipas = (sounds ?? []).flatMap((sound) => {
    const ipa = sound.ipa === undefined || sound.tags?.includes("X-SAMPA") ? null : cleanIpa(sound.ipa)
    return ipa === null ? [] : [{ ipa, tags: sound.tags ?? [] }]
  })
  const american = ipas.find((sound) => sound.tags.some((tag) => /US|General-American|GA|米/.test(tag)))
  return (american ?? ipas[0])?.ipa ?? null
}

/** Phrases Wiktionary lists under a word, which attest them as English even without an entry of their own. */
const readPhrases = (entry: RawEntry): Array<string> => {
  const derived = entry.derived ?? []
  const listed = Predicate.isString(derived) ? derived.split("\n").slice(1) : derived.map((item) => item.word ?? "")
  return [...listed, ...(entry.phrases ?? []).map((item) => item.word ?? "")]
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.includes(" ") && isEnglish(phrase))
}

/** Inflection tags named on a form-of sense in enwiktionary (via sense tags or English gloss text). */
const formOfTags = (raw: RawSense): Array<EnglishInflection> => {
  const allTags = [...(raw.tags ?? []), ...(raw.raw_tags ?? [])]
  const matched = INFLECTION_TAGS.filter(([required]) => required.every((tag) => allTags.includes(tag))).map(
    ([, code]) => code
  )
  if (matched.length > 0) {
    if (matched.includes("past-participle") && matched.includes("past")) return ["past", "past-participle"]
    return unique(matched)
  }
  const text = (raw.glosses ?? []).join(" ").toLowerCase()
  const fromText: Array<EnglishInflection> = []
  if (/\bthird[- ]person\b/.test(text)) fromText.push("third-person")
  if (/\bpresent participle\b|\bgerund\b/.test(text)) fromText.push("present-participle")
  if (/\bsimple past\b|\bpast tense\b/.test(text)) fromText.push("past")
  if (/\bpast participle\b/.test(text)) fromText.push("past-participle")
  if (/\bplural\b/.test(text)) fromText.push("plural")
  if (/\bcomparative\b/.test(text)) fromText.push("comparative")
  if (/\bsuperlative\b/.test(text)) fromText.push("superlative")
  return fromText
}

/** One form per spelling, with every inflection it is: "read" is both past and past participle. */
export const mergeInflections = (forms: ReadonlyArray<InflectedForm>): Array<InflectedForm> => {
  const merged = new Map<string, Set<EnglishInflection>>()
  for (const form of forms) {
    const tags = merged.get(form.text) ?? new Set<EnglishInflection>()
    for (const tag of form.tags) tags.add(tag)
    merged.set(form.text, tags)
  }
  return [...merged].map(([text, tags]) => ({ text, tags: [...tags] }))
}

interface EnBuilder {
  ipa: string | null
  spellings: Array<string>
  inflections: Array<InflectedForm>
  senses: Array<RawEnSense>
  entryJaTranslations: Array<string>
}

/**
 * Streaming parser for raw English Wiktionary JSONL lines from kaikki.org.
 * Extracts headwords, American-preferred IPA, inflections (including multi-word verb phrases),
 * standalone `form-of` links, and raw senses with tags, synonyms, examples, and Japanese hints.
 */
export const enwiktionaryParser = () => {
  const builders = new Map<string, EnBuilder>()
  const formsOf: Array<FormOf> = []
  const phrases = new Set<string>()

  const add = (line: string) => {
    if (!isEnglishLine(line)) return
    const decoded = decodeLine(line)
    if (Option.isNone(decoded)) return
    const entry = decoded.value
    const word = entry.word?.trim() ?? ""
    if (entry.lang_code !== "en" || word.length === 0 || !isEnglish(word)) return
    for (const phrase of readPhrases(entry)) phrases.add(phrase.toLowerCase())

    const posCode = (entry.pos ? PARTS_OF_SPEECH[entry.pos] : undefined) ?? "exp"
    const posSyns = words(entry.synonyms)
    const posAnts = words(entry.antonyms)
    const rawSenses = entry.senses ?? []
    const singleSense = rawSenses.length === 1

    const parsedSenses: Array<Omit<RawEnSense, "index">> = []
    for (const rawSense of rawSenses) {
      const allTags = [...(rawSense.tags ?? []), ...(rawSense.raw_tags ?? []), ...(rawSense.topics ?? [])]
      const isFormOrAlt =
        allTags.includes("form-of") ||
        allTags.includes("alt-of") ||
        (rawSense.form_of?.length ?? 0) > 0 ||
        (rawSense.alt_of?.length ?? 0) > 0
      if (isFormOrAlt) {
        const isStandaloneSense =
          allTags.includes("acronym") ||
          allTags.includes("initialism") ||
          allTags.includes("clipping") ||
          allTags.includes("ellipsis") ||
          allTags.includes("abbreviation") ||
          allTags.includes("contraction") ||
          entry.pos === "contraction" ||
          (entry.pos === "pron" && !allTags.includes("misspelling") && !allTags.includes("obsolete"))
        if (!isStandaloneSense) {
          if (!allTags.some((tag) => QUIET_FORMS.has(tag))) {
            const bases = [...(rawSense.form_of ?? []), ...(rawSense.alt_of ?? [])]
              .map((target) => target.word?.trim() ?? "")
              .filter((base) => base.length > 0 && base !== word && isEnglish(base))
            const tags = formOfTags(rawSense)
            for (const base of bases) formsOf.push({ text: word, base, tags })
          }
          continue
        }
      }

      const glosses = (rawSense.glosses ?? []).map((g) => g.trim()).filter((g) => g.length > 0)
      if (glosses.length === 0) continue

      const pos = [posCode]
      const misc: Array<string> =
        entry.pos === "abbrev" ? ["abbr"] : entry.pos === "proverb" ? ["proverb"] : []
      const dialects: Array<string> = []
      const fields: Array<string> = []
      for (const tag of allTags) {
        const trans = TRANSITIVITY[tag]
        const usage = USAGE[tag]
        const region = REGIONS[tag]
        const field = FIELDS[tag]
        if (trans) pos.push(trans)
        else if (usage) misc.push(usage)
        else if (region) dialects.push(region)
        else if (field) fields.push(field)
      }
      // In enwiktionary, "(UK, uncommon in North America)" produces both a dialect tag and `uncommon` ("rare").
      const filteredMisc =
        dialects.length > 0 || (rawSense.raw_tags ?? []).some((t) => /^in\b/i.test(t))
          ? misc.filter((m) => m !== "rare")
          : misc

      const jaTranslations = unique(
        (rawSense.translations ?? [])
          .filter((t) => t.code === "ja" && typeof t.word === "string" && t.word.trim().length > 0)
          .map((t) => t.word!.trim())
      )

      const synonyms = unique([...words(rawSense.synonyms), ...(singleSense ? posSyns : [])]).slice(0, MAX_REFERENCES)
      const antonyms = unique([...words(rawSense.antonyms), ...(singleSense ? posAnts : [])]).slice(0, MAX_REFERENCES)
      const examples = (rawSense.examples ?? [])
        .map((e) => e.text?.trim() ?? "")
        .filter((text) => text.length > 0 && text.length < 160)
        .slice(0, 2)

      parsedSenses.push({
        pos: unique(pos),
        glosses,
        misc: unique(filteredMisc),
        dialects: unique(dialects),
        fields: unique(fields),
        synonyms,
        antonyms,
        examples,
        jaTranslations
      })
    }

    if (parsedSenses.length === 0) return

    const builder = builders.get(word) ?? {
      ipa: null,
      spellings: [],
      inflections: [],
      senses: [],
      entryJaTranslations: []
    }
    builders.set(word, builder)
    builder.ipa ??= readIpa(entry.sounds)

    const forms = readForms(word, entry.forms ?? [])
    builder.spellings.push(...forms.spellings)
    builder.inflections.push(...forms.inflections)

    const entryJa = (entry.translations ?? [])
      .filter((t) => t.code === "ja" && typeof t.word === "string" && t.word.trim().length > 0)
      .map((t) => (t.sense ? `${t.word!.trim()} (${t.sense})` : t.word!.trim()))
    builder.entryJaTranslations.push(...entryJa)

    for (const sense of parsedSenses) {
      builder.senses.push({
        ...sense,
        index: builder.senses.length
      })
    }
  }

  const finish = () => {
    for (const form of formsOf) {
      if (form.tags.length === 0 && form.text !== form.base && form.text.toLowerCase() === form.base.toLowerCase()) {
        const source = builders.get(form.text)
        const target = builders.get(form.base)
        if (source !== undefined && target !== undefined) {
          target.ipa ??= source.ipa
          target.spellings.push(form.text, ...source.spellings)
          target.inflections.push(...source.inflections)
          target.entryJaTranslations.push(...source.entryJaTranslations)
          for (const sense of source.senses) {
            target.senses.push({ ...sense, index: target.senses.length })
          }
          builders.delete(form.text)
        }
      }
    }

    const folded = new Map<string, EnBuilder>()
    for (const [headword, builder] of builders) {
      const lower = headword.toLowerCase()
      if (!folded.has(lower)) folded.set(lower, builder)
    }
    for (const form of formsOf) {
      const base = builders.get(form.base) ?? folded.get(form.base.toLowerCase())
      if (base === undefined) continue
      if (form.tags.length === 0) base.spellings.push(form.text)
      else base.inflections.push({ text: form.text, tags: form.tags })
    }

    return {
      words: [...builders].map(
        ([headword, builder]): RawEnWord => ({
          headword,
          ipa: builder.ipa,
          spellings: unique(builder.spellings.filter((s) => s !== headword)),
          inflections: mergeInflections(builder.inflections.filter((f) => f.text !== headword)),
          senses: builder.senses,
          entryJaTranslations: unique(builder.entryJaTranslations).slice(0, 15)
        })
      ),
      formsOf,
      phrases
    }
  }

  return { add, finish }
}

/** Parses raw English Wiktionary lines; see `enwiktionaryParser`. */
export const parseEnWiktionary = (lines: Iterable<string>) => {
  const parser = enwiktionaryParser()
  for (const line of lines) parser.add(line)
  return parser.finish()
}

/**
 * Streaming parser for the consolidated English dictionary (`data/eiwa/enwiktionary-ja.jsonl`).
 */
export const wiktionaryParser = () => {
  const wordsByHeadword = new Map<string, Word>()

  const add = (line: string) => {
    const word = parseConsolidatedLine(line)
    if (word !== null && word.senses.length > 0) {
      wordsByHeadword.set(word.headword, word)
    }
  }

  const finish = () => ({
    words: [...wordsByHeadword.values()],
    formsOf: [] as ReadonlyArray<FormOf>
  })

  return { add, finish }
}

/** Parses consolidated English dictionary JSONL lines; see `wiktionaryParser`. */
export const parseWiktionary = (lines: Iterable<string>) => {
  const parser = wiktionaryParser()
  for (const line of lines) parser.add(line)
  return parser.finish()
}
