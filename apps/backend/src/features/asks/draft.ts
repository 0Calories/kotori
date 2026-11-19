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

const fits = (code: LabelCode, language: Language) =>
  language === "ja" ? !code.startsWith("en-") && code !== "uncountable" : !JAPANESE_ONLY.has(code)

type DraftOutputEntry = NonNullable<DraftOutput["entry"]>

const clean = (texts: ReadonlyArray<string>) => {
  const seen = new Set<string>()
  return texts.map((text) => text.trim()).filter((text) => text.length > 0 && !seen.has(text) && seen.add(text))
}

export const checkDraft = (entry: DraftOutputEntry, language: Language): DraftEntry | null => {
  const senses = entry.senses.map((sense) => ({
    glosses: clean(sense.glosses),
    pos: clean(sense.pos),
    labels: clean(sense.labels)
      .filter(isLabelCode)
      .filter((code) => fits(code, language)),
    usagePatterns: clean(sense.usagePatterns)
  }))
  const kept = senses.flatMap((sense, index) => (sense.glosses.length > 0 ? [index] : []))
  const headword = entry.headword.trim()
  if (kept.length === 0 || headword.length === 0) return null
  const allowed = new Set<string>(CAUTION_KINDS[language])
  const cautions = entry.cautions.flatMap((caution): Array<DraftCaution> => {
    const text = caution.text.trim()
    if (text.length === 0 || !allowed.has(caution.kind)) return []
    let sense: number | null = null
    if (caution.sense !== null) {
      // Remap 1-based raw sense numbers across dropped empty-gloss senses.
      sense = kept.indexOf(caution.sense - 1)
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

export const kanaOnly = /^[\u3040-\u30ffー]+$/u

export const draftFrequency = (score: number): SeedFrequency => ({ everyday: false, spokenCount: null, score })

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

export const nextEntryId = Effect.fn("asks.nextEntryId")(function* (db: DatabaseShape, language: Language) {
  const from = EntryId.make(language === "en" ? FIRST_ENGLISH_ID : FIRST_APPROVED_JA_ID)
  return EntryId.make((yield* topEntryId(db, language, from)) + 1)
})

export const writeDraftedEntry = Effect.fn("asks.writeDraftedEntry")(function* (
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

export const draftedEntryView = (entry: Entry): DraftView => ({
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
