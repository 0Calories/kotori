import type { DraftOutput } from "@kotori/ai"
import type { DraftEntry as DraftView, Language, Tag, WordRef } from "@kotori/contracts"
import {
  type DraftEntry,
  type DraftPitfall,
  entries,
  type EntryId,
  isLabelCode,
  labelSeverity,
  MAX_PITFALLS,
  PITFALL_KINDS,
  type PitfallKind
} from "@kotori/db"
import { inArray } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { resolveWord, tagLabels } from "../dictionary/queries.ts"
import { senseLabels } from "../dictionary/similar.ts"

/**
 * Ask Kotori drafts in the dictionary's model: Claude's output checked before it is stored, and a
 * stored draft read as an entry is. Checking keeps out what would mislead once shown: label codes
 * the vocabulary doesn't have, pitfalls of a kind that can't happen in this direction (a false
 * friend on a Japanese word), about a sense that doesn't exist, or more than three.
 */

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
    labels: clean(sense.labels).filter(isLabelCode),
    patterns: clean(sense.patterns)
  }))
  // A sense with no gloss is dropped; pitfalls name senses by their number as Claude listed them.
  const kept = senses.flatMap((sense, index) => (sense.glosses.length > 0 ? [index] : []))
  if (kept.length === 0) return null
  const allowed = new Set<string>(PITFALL_KINDS[language])
  const pitfalls = entry.pitfalls.flatMap((pitfall): Array<DraftPitfall> => {
    const text = pitfall.text.trim()
    if (text.length === 0 || !allowed.has(pitfall.kind)) return []
    let sense: number | null = null
    if (pitfall.sense !== null) {
      sense = kept.indexOf(pitfall.sense - 1)
      // About a sense that isn't there: what it warns about can't be placed, so it isn't kept.
      if (sense === -1) return []
    }
    const about = pitfall.about?.trim() ?? ""
    return [{ kind: pitfall.kind as PitfallKind, text, sense, about: about.length > 0 ? about : null }]
  })
  const headword = entry.headword.trim()
  return {
    headword,
    reading: entry.reading.trim(),
    spellings: clean(entry.spellings).filter((spelling) => spelling !== headword),
    familiarity: Math.min(5, Math.max(1, Math.round(entry.familiarity))),
    senses: kept.map((index) => senses[index]!),
    pitfalls: pitfalls.slice(0, MAX_PITFALLS)
  }
}

const wordRef = Effect.fnUntraced(function* (db: DatabaseShape, entryId: EntryId) {
  const [entry] = yield* db
    .select({ entryId: entries.id, headword: entries.headword, reading: entries.reading })
    .from(entries)
    .where(inArray(entries.id, [entryId]))
    .pipe(Effect.orDie)
  return entry ?? null
})

/** A stored draft as the app reads it: an entry's labels, patterns and pitfalls, all Kotori's. */
export const viewDraft = Effect.fnUntraced(function* (db: DatabaseShape, draft: DraftEntry, language: Language) {
  const tags = yield* tagLabels(db)
  const tag = (code: string): Tag => ({ code, label: tags.get(code) ?? code })
  const stated = senseLabels(
    draft.senses.map((sense) =>
      sense.labels
        .filter(isLabelCode)
        .map((code) => ({ code, severity: labelSeverity(code), source: "kotori" as const }))
    )
  )
  const about = new Map<string, WordRef | null>()
  for (const text of new Set(draft.pitfalls.flatMap((pitfall) => (pitfall.about === null ? [] : [pitfall.about])))) {
    const entryId = yield* resolveWord(db, text, language)
    about.set(text, entryId === null ? null : yield* wordRef(db, entryId))
  }
  return {
    headword: draft.headword,
    reading: draft.reading,
    spellings: draft.spellings,
    familiarity: draft.familiarity,
    labels: stated.word,
    senses: draft.senses.map((sense, index) => ({
      index,
      glosses: sense.glosses,
      partsOfSpeech: sense.pos.map(tag),
      labels: stated.senses[index] ?? [],
      patterns: sense.patterns.map((text) => ({ text, source: "kotori" as const, about: null }))
    })),
    pitfalls: draft.pitfalls.map((pitfall, index) => ({
      id: index,
      kind: pitfall.kind,
      text: pitfall.text,
      sense: pitfall.sense,
      about: pitfall.about === null ? null : (about.get(pitfall.about) ?? null),
      source: "kotori" as const
    }))
  } satisfies DraftView
})
