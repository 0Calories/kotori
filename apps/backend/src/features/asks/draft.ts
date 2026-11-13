import { checkCautions, type DraftOutput } from "@kotori/ai"
import type { DraftEntry as DraftView, Language, Tag, WordRef } from "@kotori/contracts"
import { type DraftEntry, entries, type EntryId, isLabelCode, type LabelCode, labelSeverity } from "@kotori/db"
import { inArray } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { findForms, tagNames } from "../dictionary/queries.ts"
import { senseLabels } from "../dictionary/similar.ts"

/**
 * Ask Kotori drafts in the dictionary's model: Claude's output checked before it is stored, and a
 * stored draft read as an entry is. Checking keeps out what would mislead once shown: label codes
 * the vocabulary doesn't have or the word's language can't carry (keigo on an English word, a
 * British label on a Japanese one), and cautions the dictionary's own pass would drop
 * (`checkCautions` in `@kotori/ai`): of a kind that can't happen in this direction (wasei-eigo on a
 * Japanese word), about a sense that doesn't exist, naming a sense by its number, or more than three.
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
  // A sense with no gloss is dropped.
  const kept = senses.flatMap((sense, index) => (sense.glosses.length > 0 ? [index] : []))
  const headword = entry.headword.trim()
  if (kept.length === 0 || headword.length === 0) return null
  // Claude numbered senses as it listed them, glossless ones included: place each on the kept ones.
  const { cautions } = checkCautions(entry.cautions, {
    language,
    headword,
    placeSense: (sense) => {
      const position = kept.indexOf(sense - 1)
      // About a sense that isn't there: what it is about can't be placed, so it isn't kept.
      return position === -1 ? null : position
    }
  })
  return {
    headword,
    reading: entry.reading.trim(),
    spellings: clean(entry.spellings).filter((spelling) => spelling !== headword),
    frequency: Math.min(5, Math.max(1, Math.round(entry.frequency))),
    senses: kept.map((index) => senses[index]!),
    cautions
  }
}

/** How `findForms` matches a word: English whatever its case, Japanese as written. */
const formKey = (text: string, language: Language) =>
  `${language}\u0000${language === "en" ? text.toLowerCase() : text}`

/**
 * The words stored drafts' cautions name, as links: one lookup per language for every draft, and
 * a word links only when exactly one entry is written that way (上手 links to neither).
 */
const namedWords = Effect.fnUntraced(function* (
  db: DatabaseShape,
  drafts: ReadonlyArray<{ readonly draft: DraftEntry; readonly language: Language }>
) {
  const owners = new Map<string, Set<EntryId>>()
  for (const language of ["en", "ja"] as const) {
    const texts = [
      ...new Set(
        drafts
          .filter((stored) => stored.language === language)
          .flatMap(({ draft }) => draft.cautions.flatMap((caution) => (caution.about === null ? [] : [caution.about])))
      )
    ]
    for (const form of yield* findForms(db, texts, language)) {
      if (form.kind === "inflection") continue
      const key = formKey(form.text, language)
      owners.set(key, (owners.get(key) ?? new Set()).add(form.entryId))
    }
  }
  const linked = [...owners.values()].flatMap((ids) => (ids.size === 1 ? [...ids] : []))
  const refs = new Map<EntryId, WordRef>()
  if (linked.length > 0) {
    const rows = yield* db
      .select({ entryId: entries.id, headword: entries.headword, reading: entries.reading })
      .from(entries)
      .where(inArray(entries.id, linked))
      .pipe(Effect.orDie)
    for (const row of rows) refs.set(row.entryId, row)
  }
  return (text: string, language: Language): WordRef | null => {
    const ids = owners.get(formKey(text, language))
    return ids?.size === 1 ? (refs.get([...ids][0]!) ?? null) : null
  }
})

/**
 * Stored drafts as the app reads them: an entry's labels, usage patterns and cautions, all Kotori's.
 * A list of them costs the same few queries as one.
 */
export const viewDrafts = Effect.fnUntraced(function* (
  db: DatabaseShape,
  drafts: ReadonlyArray<{ readonly draft: DraftEntry; readonly language: Language }>
) {
  if (drafts.length === 0) return []
  const tags = yield* tagNames(db)
  const tag = (code: string): Tag => ({ code, name: tags.get(code) ?? code })
  const named = yield* namedWords(db, drafts)
  return drafts.map(({ draft, language }) => view(draft, language, tag, named))
})

/** A stored draft as the app reads it; see `viewDrafts`. */
export const viewDraft = (db: DatabaseShape, draft: DraftEntry, language: Language) =>
  viewDrafts(db, [{ draft, language }]).pipe(Effect.map((views) => views[0]!))

const view = (
  draft: DraftEntry,
  language: Language,
  tag: (code: string) => Tag,
  named: (text: string, language: Language) => WordRef | null
): DraftView => {
  const stated = senseLabels(
    draft.senses.map((sense) =>
      sense.labels
        .filter(isLabelCode)
        .map((code) => ({ code, severity: labelSeverity(code), source: "kotori" as const }))
    )
  )
  return {
    headword: draft.headword,
    reading: draft.reading,
    spellings: draft.spellings,
    frequency: draft.frequency,
    labels: stated.word,
    senses: draft.senses.map((sense, index) => ({
      index,
      glosses: sense.glosses,
      partsOfSpeech: sense.pos.map(tag),
      labels: stated.senses[index] ?? [],
      usagePatterns: sense.usagePatterns.map((text) => ({ text, source: "kotori" as const, about: null }))
    })),
    cautions: draft.cautions.map((caution, index) => ({
      id: index,
      kind: caution.kind,
      text: caution.text,
      sense: caution.sense,
      about: caution.about === null ? null : named(caution.about, language),
      source: "kotori" as const
    }))
  }
}
