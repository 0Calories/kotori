import type { SenseRecord } from "@kotori/contracts"
import type { EnglishInflection } from "@kotori/language"
import { Option, Schema } from "effect"

/** An inflected form of a word and what it is: "ate", past. */
export interface InflectedForm {
  readonly text: string
  readonly tags: ReadonlyArray<EnglishInflection>
}

/**
 * Synonyms and antonyms a source lists for a run of senses (a part of speech) rather than for
 * one: placed on the sense they belong to once every word is known (see `placeReferences`).
 */
export interface References {
  /** The senses they were listed for, as `senses.slice(from, to)`. */
  readonly from: number
  readonly to: number
  readonly synonyms: ReadonlyArray<string>
  readonly antonyms: ReadonlyArray<string>
}

/** One English headword as consolidated from English Wiktionary, with its senses in Japanese. */
export interface Word {
  readonly headword: string
  /** IPA, when the source gives it. */
  readonly ipa: string | null
  /** 1–5 modern spoken/everyday familiarity rating from the consolidation pass. */
  readonly familiarity?: number | undefined
  /** Other ways the word is spelled ("colour"). */
  readonly spellings: ReadonlyArray<string>
  readonly inflections: ReadonlyArray<InflectedForm>
  readonly senses: ReadonlyArray<SenseRecord>
  readonly references?: ReadonlyArray<References>
}

/**
 * A form a source lists on its own that only points at another word: "ate" is the past of
 * "eat"; "colour", with no inflection, is a spelling of "color". It joins that word's forms.
 */
export interface FormOf {
  readonly text: string
  readonly base: string
  readonly tags: ReadonlyArray<EnglishInflection>
}

/** A sense with nothing but glosses filled in; parsers add the rest. */
export const emptySense = (): SenseRecord => ({
  glosses: [],
  pos: [],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  sources: [],
  wasei: false
})

/** Words made only of English letters, digits and the punctuation inside English words and phrases. */
export const isEnglish = (text: string) => /^[A-Za-z0-9][A-Za-z0-9 '’.\-&/]*$/.test(text)

// --- Consolidated JSONL schema (`data/eiwa/enwiktionary-ja.jsonl`) ----------------------

export const EnglishInflectionSchema = Schema.Literals([
  "plural",
  "third-person",
  "past",
  "past-participle",
  "present-participle",
  "comparative",
  "superlative"
])

export const ConsolidatedInflection = Schema.Struct({
  text: Schema.String,
  tags: Schema.Array(EnglishInflectionSchema)
})
export type ConsolidatedInflection = typeof ConsolidatedInflection.Type

export const ConsolidatedSense = Schema.Struct({
  pos: Schema.Array(Schema.String),
  misc: Schema.optional(Schema.Array(Schema.String)),
  fields: Schema.optional(Schema.Array(Schema.String)),
  dialects: Schema.optional(Schema.Array(Schema.String)),
  glosses: Schema.Array(Schema.String),
  info: Schema.optional(Schema.Array(Schema.String)),
  synonyms: Schema.optional(Schema.Array(Schema.String)),
  antonyms: Schema.optional(Schema.Array(Schema.String))
})
export type ConsolidatedSense = typeof ConsolidatedSense.Type

/**
 * One line of `data/eiwa/enwiktionary-ja.jsonl`: an English Wiktionary entry whose senses
 * have been consolidated, ranked commonest-first, and glossed in Japanese.
 */
export const ConsolidatedWord = Schema.Struct({
  headword: Schema.String,
  ipa: Schema.NullOr(Schema.String),
  familiarity: Schema.optional(Schema.Int),
  spellings: Schema.optional(Schema.Array(Schema.String)),
  inflections: Schema.optional(Schema.Array(ConsolidatedInflection)),
  senses: Schema.Array(ConsolidatedSense)
})
export type ConsolidatedWord = typeof ConsolidatedWord.Type

const decodeConsolidatedLine = Schema.decodeUnknownOption(Schema.fromJsonString(ConsolidatedWord))

export const fromConsolidatedWord = (consolidated: ConsolidatedWord): Word => ({
  headword: consolidated.headword,
  ipa: consolidated.ipa,
  familiarity: consolidated.familiarity,
  spellings: consolidated.spellings ?? [],
  inflections: consolidated.inflections ?? [],
  senses: consolidated.senses.map((sense) => ({
    ...emptySense(),
    glosses: sense.glosses.map((text) => ({ text, type: null })),
    pos: sense.pos,
    misc: sense.misc ?? [],
    fields: sense.fields ?? [],
    dialects: sense.dialects ?? [],
    info: sense.info ?? [],
    xrefs: sense.synonyms ?? [],
    antonyms: sense.antonyms ?? []
  }))
})

export const toConsolidatedWord = (word: Word): ConsolidatedWord => ({
  headword: word.headword,
  ipa: word.ipa,
  ...(word.familiarity === undefined ? {} : { familiarity: word.familiarity }),
  ...(word.spellings.length > 0 ? { spellings: [...word.spellings] } : {}),
  ...(word.inflections.length > 0
    ? { inflections: word.inflections.map((f) => ({ text: f.text, tags: [...f.tags] })) }
    : {}),
  senses: word.senses.map((sense) => ({
    pos: [...sense.pos],
    ...(sense.misc.length > 0 ? { misc: [...sense.misc] } : {}),
    ...(sense.fields.length > 0 ? { fields: [...sense.fields] } : {}),
    ...(sense.dialects.length > 0 ? { dialects: [...sense.dialects] } : {}),
    glosses: sense.glosses.map((gloss) => gloss.text),
    ...(sense.info.length > 0 ? { info: [...sense.info] } : {}),
    ...(sense.xrefs.length > 0 ? { synonyms: [...sense.xrefs] } : {}),
    ...(sense.antonyms.length > 0 ? { antonyms: [...sense.antonyms] } : {})
  }))
})

export const parseConsolidatedLine = (line: string): Word | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  const decoded = decodeConsolidatedLine(trimmed)
  return Option.isSome(decoded) ? fromConsolidatedWord(decoded.value) : null
}
