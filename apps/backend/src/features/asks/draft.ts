import type { DraftOutput } from "@kotori/ai"
import type { DraftEntry as DraftView, Entry, EntryRecord, Language, SenseRecord } from "@kotori/contracts"
import {
  CAUTION_KINDS,
  type CautionKind,
  type DraftCaution,
  type DraftEntry,
  type DraftSense,
  EntryId,
  FIRST_APPROVED_JA_ID,
  FIRST_ENGLISH_ID,
  isLabelCode,
  type LabelCode,
  MAX_CAUTIONS
} from "@kotori/db"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { insertEntries, saveKotoriCautions, topEntryId } from "../dictionary/index.ts"
import type { SeedFrequency } from "../dictionary/import/seedFacts.ts"

/**
 * Ask Kotori drafts in the dictionary's model: Claude's output checked, then written into the
 * dictionary as an unreviewed entry, and read back as an entry is. Checking keeps out what would mislead once shown: label codes
 * the vocabulary doesn't have or the word's language can't carry (keigo on an English word, a
 * British label on a Japanese one), cautions of a kind that can't happen in this direction (wasei-eigo
 * on a Japanese word), about a sense that doesn't exist, or more than three.
 */

/** Labels only Japanese words carry: keigo, dialects, wasei-eigo, four-kanji idioms. */
const JAPANESE_ONLY = new Set<LabelCode>([
  "hon",
  "hum",
  "pol",
  "ksb",
  "osb",
  "ktb",
  "kyb",
  "kyu",
  "hob",
  "thb",
  "tsb",
  "tsug",
  "rkb",
  "nab",
  "bra",
  "wasei",
  "yoji"
])

/** Whether a word in `language` can carry the label; English's are its regions and countability. */
const fits = (code: LabelCode, language: Language) =>
  language === "ja" ? !code.startsWith("en-") && code !== "uncountable" : !JAPANESE_ONLY.has(code)

type DraftOutputEntry = NonNullable<DraftOutput["entry"]>

const clean = (texts: ReadonlyArray<string>) => {
  const seen = new Set<string>()
  return texts.map((text) => text.trim()).filter((text) => text.length > 0 && !seen.has(text) && seen.add(text))
}

/** Claude's draft as stored, or null when no sense survives the check. */
export const checkDraft = (entry: DraftOutputEntry, language: Language): DraftEntry | null => {
  const senses = entry.senses.map((sense) => ({
    glosses: clean(sense.glosses),
    pos: clean(sense.pos),
    labels: clean(sense.labels)
      .filter(isLabelCode)
      .filter((code) => fits(code, language)),
    usagePatterns: clean(sense.usagePatterns)
  }))
  // A sense with no gloss is dropped; cautions name senses by their number as Claude listed them.
  const kept = senses.flatMap((sense, index) => (sense.glosses.length > 0 ? [index] : []))
  const headword = entry.headword.trim()
  if (kept.length === 0 || headword.length === 0) return null
  const allowed = new Set<string>(CAUTION_KINDS[language])
  const cautions = entry.cautions.flatMap((caution): Array<DraftCaution> => {
    const text = caution.text.trim()
    if (text.length === 0 || !allowed.has(caution.kind)) return []
    let sense: number | null = null
    if (caution.sense !== null) {
      sense = kept.indexOf(caution.sense - 1)
      // About a sense that isn't there: what it is about can't be placed, so it isn't kept.
      if (sense === -1) return []
    }
    const about = caution.about?.trim() ?? ""
    return [{ kind: caution.kind as CautionKind, text, sense, about: about.length > 0 ? about : null }]
  })
  return {
    headword,
    reading: entry.reading.trim(),
    spellings: clean(entry.spellings).filter((spelling) => spelling !== headword),
    frequency: Math.min(5, Math.max(1, Math.round(entry.frequency))),
    senses: kept.map((index) => senses[index]!),
    cautions: cautions.slice(0, MAX_CAUTIONS)
  }
}

/** Kana alone: a Japanese form written so is a kana form, any other a kanji one. */
export const kanaOnly = /^[\u3040-\u30ffー]+$/u

/** A drafted word's frequency signals: the 1–5 score Claude judged, nothing counted. */
export const draftFrequency = (score: number): SeedFrequency => ({ everyday: false, spokenCount: null, score })

/**
 * A draft sense as the dictionary stores senses: its labels as usage codes and its usage patterns as
 * notes, which the import reads back as labels and usage patterns with the entry's source, Kotori.
 */
const toSense = (sense: DraftSense): SenseRecord => ({
  glosses: sense.glosses.map((text) => ({ text, type: null })),
  pos: [...sense.pos],
  misc: [...sense.labels],
  fields: [],
  dialects: [],
  info: [...sense.usagePatterns],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  origins: [],
  wasei: false
})

const japaneseForm = (text: string) => ({
  kind: kanaOnly.test(text) ? ("kana" as const) : ("kanji" as const),
  text,
  common: false,
  tags: [],
  priorities: [],
  restrictions: [],
  noKanji: false
})

/** The entry a draft becomes, in the language's record shape, with the given id. */
export const draftToRecord = (draft: DraftEntry, language: Language, id: EntryId): EntryRecord => {
  const spellings = [...new Set(draft.spellings.filter((text) => text !== draft.headword))]
  return {
    id,
    language,
    source: "kotori",
    headword: draft.headword,
    reading: draft.reading,
    common: false,
    priority: 0,
    forms:
      language === "en"
        ? [draft.headword, ...spellings].map((text, index) => ({
            kind: "spelling" as const,
            text,
            common: index === 0,
            tags: [],
            priorities: [],
            restrictions: [],
            noKanji: false
          }))
        : [
            japaneseForm(draft.headword),
            ...(draft.reading.length > 0 && draft.reading !== draft.headword
              ? [{ ...japaneseForm(draft.reading), kind: "kana" as const }]
              : []),
            ...spellings.map(japaneseForm)
          ],
    senses: draft.senses.map(toSense)
  }
}

/** The next free entry id in a dictionary's Kotori block, past every entry there, drafts included. */
export const nextEntryId = Effect.fn("asks.nextEntryId")(function* (db: DatabaseShape, language: Language) {
  const from = EntryId.make(language === "en" ? FIRST_ENGLISH_ID : FIRST_APPROVED_JA_ID)
  return EntryId.make((yield* topEntryId(db, language, from)) + 1)
})

/**
 * Writes a checked draft into the dictionary as an `unreviewed` Kotori entry (ADR 0002), with its
 * cautions and its frequency score as the word's frequency signal, and returns its id. Nothing is
 * enriched until the admin approves it.
 */
export const writeDraft = Effect.fn("asks.writeDraft")(function* (
  db: DatabaseShape,
  draft: DraftEntry,
  language: Language
) {
  const id = yield* nextEntryId(db, language)
  const record = draftToRecord(draft, language, id)
  yield* insertEntries(db, [{ ...record, frequency: draftFrequency(draft.frequency), review: "unreviewed" }], {
    seeded: true
  })
  yield* saveKotoriCautions(db, id, language, draft.cautions)
  return id
})

/** A drafted entry as Ask Kotori's answer shows it: the entry's own facts, all Kotori's. */
export const draftView = (entry: Entry): DraftView => ({
  id: entry.id,
  headword: entry.headword,
  reading: entry.reading,
  spellings: entry.forms
    .filter((form) => form.kind !== "inflection" && form.text !== entry.headword && form.text !== entry.reading)
    .map((form) => form.text),
  frequency: entry.frequency?.score ?? 1,
  labels: entry.labels,
  senses: entry.senses.map((sense) => ({
    index: sense.index,
    glosses: sense.glosses,
    partsOfSpeech: sense.partsOfSpeech,
    labels: sense.labels,
    usagePatterns: sense.usagePatterns
  })),
  cautions: entry.cautions
})
