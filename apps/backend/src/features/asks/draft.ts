import type { DraftOutput } from "@kotori/ai"
import type { Language, SenseRecord } from "@kotori/contracts"
import {
  CAUTION_KINDS,
  type CautionKind,
  type DraftCaution,
  type DraftEntry,
  type DraftSense,
  type EntryId,
  isLabelCode,
  type LabelCode,
  MAX_CAUTIONS
} from "@kotori/db"
import type { ImportEntry } from "../dictionary/import/seedFacts.ts"

/**
 * Ask Kotori drafts in the dictionary's model: Claude's output checked before it is stored directly
 * in `entries` under a `kotori:<id>` identifier with `review_state = 'unreviewed'`. Checking keeps
 * out what would mislead once shown: label codes the vocabulary doesn't have or the word's language
 * can't carry (keigo on an English word, a British label on a Japanese one), cautions of a kind
 * that can't happen in this direction (wasei-eigo on a Japanese word), about a sense that doesn't
 * exist, or more than three.
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

/** Claude's draft as validated before writing to `entries`, or null when no sense survives the check. */
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

const kanaOnly = /^[\u3040-\u30ffー]+$/u

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

/** Converts a validated draft into an `ImportEntry` ready to insert into `entries` with `reviewState = 'unreviewed'`. */
export const draftToEntryRecord = (draft: DraftEntry, language: Language, id: EntryId): ImportEntry => {
  const spellings = [...new Set(draft.spellings.filter((text) => text !== draft.headword))]
  return {
    id,
    language,
    source: "kotori",
    headword: draft.headword,
    reading: draft.reading,
    common: false,
    priority: 0,
    frequency: { everyday: false, spokenCount: null, score: draft.frequency },
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
            {
              kind: kanaOnly.test(draft.headword) ? ("kana" as const) : ("kanji" as const),
              text: draft.headword,
              common: false,
              tags: [],
              priorities: [],
              restrictions: [],
              noKanji: false
            },
            ...(draft.reading.length > 0 && draft.reading !== draft.headword
              ? [
                  {
                    kind: "kana" as const,
                    text: draft.reading,
                    common: false,
                    tags: [],
                    priorities: [],
                    restrictions: [],
                    noKanji: false
                  }
                ]
              : []),
            ...spellings.map((text) => ({
              kind: kanaOnly.test(text) ? ("kana" as const) : ("kanji" as const),
              text,
              common: false,
              tags: [],
              priorities: [],
              restrictions: [],
              noKanji: false
            }))
          ],
    senses: draft.senses.map(toSense)
  }
}
