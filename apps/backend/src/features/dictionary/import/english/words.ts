import type { SenseRecord } from "@kotori/contracts"
import type { DraftCaution, Source } from "@kotori/db"
import { type EnglishInflection, normalizeGloss } from "@kotori/language"
import { Option, Schema } from "effect"
import type { ImportSense } from "../seedFacts.ts"

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

/** One English headword as one source has it, with its senses in Japanese. */
export interface Word {
  readonly headword: string
  /** IPA, when the source gives it. */
  readonly ipa: string | null
  /** 1–5 modern spoken/everyday frequency rating from the curated consolidation pass. */
  readonly frequency?: number | undefined
  /** Other ways the word is spelled ("colour"). */
  readonly spellings: ReadonlyArray<string>
  readonly inflections: ReadonlyArray<InflectedForm>
  readonly senses: ReadonlyArray<ImportSense>
  readonly references?: ReadonlyArray<References>
  /** Where its senses came from, when not its tier's default source: Kotori, for approved Ask Kotori words. */
  readonly source?: Source | undefined
  /** Kotori's cautions on an approved Ask Kotori word, written once the word has its id. */
  readonly cautions?: ReadonlyArray<DraftCaution> | undefined
  /**
   * The subtitles may count a name spelled the same way ("kim", "erica"), so the count
   * can't say the word is common.
   */
  readonly mayBeName?: boolean
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
  origins: [],
  wasei: false
})

/** The inflections a gloss such as "tireの過去形・過去分詞" or "beの過去分詞形" names. */
export const inflectionsNamed = (text: string): Array<EnglishInflection> => {
  const tags: Array<EnglishInflection> = []
  if (/複数/.test(text)) tags.push("plural")
  // "the third person singular" is the -s form; "一人称および三人称単数過去形" is a past.
  if (/三人称/.test(text) && !text.includes("過去")) tags.push("third-person")
  if (text.replace(/過去分詞/g, "").includes("過去")) tags.push("past")
  if (/過去分詞/.test(text)) tags.push("past-participle")
  if (/現在分詞|動名詞/.test(text)) tags.push("present-participle")
  if (/比較級/.test(text)) tags.push("comparative")
  if (/最上級/.test(text)) tags.push("superlative")
  return tags
}

/** The word a gloss names at its start, bare or quoted: beの…, "ask" の…, 「look」の…, 'tisの…. */
const BASE = /^["“「]?([A-Za-z'][A-Za-z' .-]*?)["”」]?\s*の\s*/

/** "beの過去分詞形", "\"ask\" の過去形・過去分詞形", "win の過去・過去分詞": an inflection of another word. */
const INFLECTION_OF = new RegExp(
  `${BASE.source}([^/]*?(?:過去|分詞|三人称|複数|比較級|最上級|現在形|動名詞)[^/]*?)。?$`
)

/** "Atumの異綴", "cinqueの旧綴り", "judgmentの異綴、米国でも時折みられる": another spelling of the word. */
const SPELLING_OF = new RegExp(`${BASE.source}(?:異綴り?|別綴り|旧綴り|異形|別表記|綴り誤り)(?:[、。].*)?$`)

/**
 * The word a gloss says this one is a form of, and which inflections it is (none for another
 * spelling), or null for a gloss that is a meaning.
 */
export const formOf = (
  gloss: string
): { readonly base: string; readonly tags: ReadonlyArray<EnglishInflection> } | null => {
  const text = gloss.trim()
  const spelling = SPELLING_OF.exec(text)
  if (spelling !== null) return { base: spelling[1]!.trim(), tags: [] }
  const inflection = INFLECTION_OF.exec(text)
  if (inflection === null) return null
  const tags = inflectionsNamed(inflection[2]!)
  return tags.length === 0 ? null : { base: inflection[1]!.trim(), tags }
}

/** Words made only of English letters, digits and the punctuation inside English words and phrases. */
export const isEnglish = (text: string) => /^[A-Za-z0-9][A-Za-z0-9 '’.\-&/]*$/.test(text)

export const addRedirect = (redirects: Map<string, string>, variant: string, target: string): boolean => {
  const from = normalizeGloss(variant)
  const to = target.trim().toLowerCase()
  const normTo = normalizeGloss(to)
  if (from.includes(" ") && normTo.includes(" ") && from !== normTo && isEnglish(from) && isEnglish(to)) {
    redirects.set(from, to)
    return true
  }
  return false
}

// --- Consolidated JSONL schema (`data/english/enwiktionary-ja.jsonl`) ----------------------

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
 * One line of `data/english/enwiktionary-ja.jsonl`: an English Wiktionary entry whose senses
 * have been consolidated, ranked commonest-first, and glossed in Japanese.
 */
export const ConsolidatedWord = Schema.Struct({
  headword: Schema.String,
  ipa: Schema.NullOr(Schema.String),
  frequency: Schema.optional(Schema.Int),
  spellings: Schema.optional(Schema.Array(Schema.String)),
  inflections: Schema.optional(Schema.Array(ConsolidatedInflection)),
  senses: Schema.Array(ConsolidatedSense)
})
export type ConsolidatedWord = typeof ConsolidatedWord.Type

const decodeConsolidatedLine = Schema.decodeUnknownOption(Schema.fromJsonString(ConsolidatedWord))

export const fromConsolidatedWord = (consolidated: ConsolidatedWord): Word => ({
  headword: consolidated.headword,
  ipa: consolidated.ipa,
  frequency: consolidated.frequency,
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
  ...(word.frequency === undefined ? {} : { frequency: word.frequency }),
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
