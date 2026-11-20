import type { Language } from "@kotori/contracts"
import {
  type BaseCaution,
  type BaseLoanLink,
  entries,
  type EnrichedLabel,
  type EntryEnrichment,
  type EntryId,
  type LoanLinkMeaning,
  MAX_CAUTIONS
} from "@kotori/db"
import { and, eq, isNotNull, ne } from "drizzle-orm"
import { Console, Effect } from "effect"
import { chunks } from "../../../db/chunks.ts"
import type { DatabaseShape } from "../../../db/Database.ts"
import { type EntryDocument, findForms, getEntryDocuments } from "../queries.ts"
import { ARTIFACTS, CautionLine, FormalLabelLine, LoanLine, type Pass, readArtifact } from "./artifacts.ts"
import { registerUnsaid } from "./candidates.ts"

export interface Applied {
  readonly written: number
  readonly removed: number
}

const stillJudged = Effect.fnUntraced(function* (
  db: DatabaseShape,
  language: Language,
  lines: ReadonlyArray<{ readonly entryId: EntryId; readonly headword: string }>
) {
  const found = new Map<EntryId, EntryDocument>()
  const wanted = new Map(lines.map((line) => [line.entryId, line.headword]))
  for (const chunk of chunks([...wanted.keys()], 5000)) {
    const docs = yield* getEntryDocuments(db, chunk)
    for (const doc of docs) {
      if (doc.language === language && doc.source !== "kotori" && wanted.get(doc.id) === doc.base.headword) {
        found.set(doc.id, doc)
      }
    }
  }
  return found
})

const senseIndexByFirstGloss = (doc: EntryDocument) => {
  const map = new Map<string, number>()
  doc.base.senses.forEach((sense, index) => {
    const first = sense.glosses[0]?.text
    if (first !== undefined && !map.has(first)) map.set(first, index)
  })
  return map
}

const cleanEnrichment = (enrichment: EntryEnrichment): EntryEnrichment | null => {
  const hasAny =
    (enrichment.examples?.length ?? 0) > 0 ||
    (enrichment.cautions?.length ?? 0) > 0 ||
    (enrichment.labels?.length ?? 0) > 0 ||
    (enrichment.usagePatterns?.length ?? 0) > 0 ||
    enrichment.loanLink != null
  return hasAny ? enrichment : null
}

/** Applies Kotori's `form` labels from `data/labels/ja-form.jsonl` into `entries.enrichment.labels`. */
export const applyFormalLabels = Effect.fn("passes.applyFormalLabels")(function* (
  db: DatabaseShape,
  lines: ReadonlyArray<FormalLabelLine>
) {
  const valid = yield* stillJudged(db, "ja", lines)
  let written = 0
  let removed = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const held = yield* tx
          .select({ id: entries.id, enrichment: entries.enrichment })
          .from(entries)
          .where(and(eq(entries.language, "ja"), ne(entries.source, "kotori"), isNotNull(entries.enrichment)))
        for (const row of held) {
          const existingLabels = row.enrichment?.labels ?? []
          const hadForm = existingLabels.some((l) => l.code === "form" && l.source === "kotori")
          if (!hadForm || valid.has(row.id)) continue
          removed++
          const nextLabels = existingLabels.filter((l) => !(l.code === "form" && l.source === "kotori"))
          const next = cleanEnrichment({ ...row.enrichment, labels: nextLabels.length > 0 ? nextLabels : undefined })
          yield* tx.update(entries).set({ enrichment: next }).where(eq(entries.id, row.id))
        }
        for (const line of lines) {
          const doc = valid.get(line.entryId)
          if (doc === undefined) continue
          const byGloss = senseIndexByFirstGloss(doc)
          const keptLabels = (doc.enrichment?.labels ?? []).filter((l) => !(l.code === "form" && l.source === "kotori"))
          const added: Array<EnrichedLabel> = []
          for (const { gloss } of line.form) {
            const senseIndex = byGloss.get(gloss)
            if (senseIndex === undefined) continue
            const baseCodes = (doc.base.senses[senseIndex]?.labels ?? []).map((l) => l.code)
            if (!registerUnsaid(baseCodes)) continue
            added.push({ sense: senseIndex, code: "form", source: "kotori" })
          }
          written += added.length
          const merged = [...keptLabels, ...added]
          const next = cleanEnrichment({ ...doc.enrichment, labels: merged.length > 0 ? merged : undefined })
          yield* tx.update(entries).set({ enrichment: next }).where(eq(entries.id, doc.id))
        }
      })
    )
    .pipe(Effect.orDie)
  return { written, removed } satisfies Applied
})

const wordsNamed = Effect.fnUntraced(function* (db: DatabaseShape, texts: ReadonlyArray<string>, language: Language) {
  const key = (text: string) => (language === "en" ? text.toLowerCase() : text)
  const owners = new Map<string, Set<EntryId>>()
  for (const chunk of chunks([...new Set(texts)], 2000)) {
    for (const form of yield* findForms(db, [...chunk], language)) {
      if (form.kind === "inflection") continue
      const owned = owners.get(key(form.text)) ?? new Set<EntryId>()
      owned.add(form.entryId)
      owners.set(key(form.text), owned)
    }
  }
  return (text: string): EntryId | null => {
    const owned = owners.get(key(text))
    return owned !== undefined && owned.size === 1 ? [...owned][0]! : null
  }
})

/** Applies Kotori's cautions from `data/cautions/{ja,en}.jsonl` into `entries.enrichment.cautions`. */
export const applyCautions = Effect.fn("passes.applyCautions")(function* (
  db: DatabaseShape,
  language: Language,
  lines: ReadonlyArray<CautionLine>
) {
  const valid = yield* stillJudged(db, language, lines)
  const named = yield* wordsNamed(
    db,
    lines.flatMap((line) => line.cautions.flatMap((caution) => (caution.about === null ? [] : [caution.about]))),
    language
  )
  let written = 0
  let removed = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const held = yield* tx
          .select({ id: entries.id, enrichment: entries.enrichment })
          .from(entries)
          .where(and(eq(entries.language, language), ne(entries.source, "kotori"), isNotNull(entries.enrichment)))
        for (const row of held) {
          if ((row.enrichment?.cautions?.length ?? 0) === 0 || valid.has(row.id)) continue
          removed++
          const next = cleanEnrichment({ ...row.enrichment, cautions: undefined })
          yield* tx.update(entries).set({ enrichment: next }).where(eq(entries.id, row.id))
        }
        for (const line of lines) {
          const doc = valid.get(line.entryId)
          if (doc === undefined) continue
          const byGloss = senseIndexByFirstGloss(doc)
          const placed: Array<BaseCaution> = line.cautions
            .flatMap((caution): Array<BaseCaution> => {
              const sense = caution.sense === null ? null : byGloss.get(caution.sense)
              if (sense === undefined) return []
              return [
                {
                  sense,
                  kind: caution.kind,
                  text: caution.text,
                  aboutEntryId: caution.about === null ? null : named(caution.about),
                  source: "kotori"
                }
              ]
            })
            .slice(0, MAX_CAUTIONS)
          written += placed.length
          const next = cleanEnrichment({ ...doc.enrichment, cautions: placed.length > 0 ? placed : undefined })
          yield* tx.update(entries).set({ enrichment: next }).where(eq(entries.id, doc.id))
        }
      })
    )
    .pipe(Effect.orDie)
  return { written, removed } satisfies Applied
})

/** Applies Kotori's loan verdicts from `data/loans/verdicts.jsonl` into `entries.enrichment.loanLink`. */
export const applyLoanVerdicts = Effect.fn("passes.applyLoanVerdicts")(function* (
  db: DatabaseShape,
  lines: ReadonlyArray<LoanLine>
) {
  const verdicts = lines.filter(
    (line): line is LoanLine & { katakana: string; meaning: LoanLinkMeaning } =>
      line.katakana !== null && line.meaning !== null
  )
  const english = yield* stillJudged(
    db,
    "en",
    verdicts.map((line) => ({ entryId: line.englishId, headword: line.english }))
  )
  const katakana = yield* stillJudged(
    db,
    "ja",
    verdicts.flatMap((line) =>
      line.katakanaId === null ? [] : [{ entryId: line.katakanaId, headword: line.katakana }]
    )
  )
  const valid = verdicts.filter(
    (line) => english.has(line.englishId) && (line.katakanaId === null || katakana.has(line.katakanaId))
  )
  const coveredIds = new Set<EntryId>()
  for (const line of valid) {
    coveredIds.add(line.englishId)
    if (line.katakanaId !== null) coveredIds.add(line.katakanaId)
  }
  let written = 0
  let removed = 0
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const held = yield* tx
          .select({ id: entries.id, enrichment: entries.enrichment })
          .from(entries)
          .where(isNotNull(entries.enrichment))
        for (const row of held) {
          if (row.enrichment?.loanLink == null || coveredIds.has(row.id)) continue
          removed++
          const next = cleanEnrichment({ ...row.enrichment, loanLink: undefined })
          yield* tx.update(entries).set({ enrichment: next }).where(eq(entries.id, row.id))
        }
        for (const line of valid) {
          const enDoc = english.get(line.englishId)!
          const jaDoc = line.katakanaId === null ? undefined : katakana.get(line.katakanaId)
          const source = enDoc.base.loanLink?.source ?? jaDoc?.base.loanLink?.source ?? "kotori"
          const link: BaseLoanLink = {
            katakana: line.katakana,
            katakanaEntryId: line.katakanaId,
            english: line.english,
            englishEntryId: line.englishId,
            meaning: line.meaning,
            source,
            meaningSource: "kotori"
          }
          const targets = jaDoc === undefined ? [enDoc] : [enDoc, jaDoc]
          for (const target of targets) {
            const next = cleanEnrichment({ ...target.enrichment, loanLink: link })
            yield* tx.update(entries).set({ enrichment: next }).where(eq(entries.id, target.id))
          }
          written++
        }
      })
    )
    .pipe(Effect.orDie)
  return { written, removed } satisfies Applied
})

export const applyArtifacts = Effect.fn("passes.applyArtifacts")(function* (
  db: DatabaseShape,
  files: { readonly [P in Pass]: string } = ARTIFACTS
) {
  const report = (path: string, present: boolean, applied: Applied, what: string, gone: string, unit = "words") => {
    const removed = applied.removed > 0 ? `removed ${gone} from ${applied.removed.toLocaleString()} ${unit}` : null
    if (!present) return removed === null ? Effect.void : Console.log(`No ${path}: ${removed}.`)
    return Console.log(
      `Applied ${path}: ${applied.written.toLocaleString()} ${what}` +
        (removed === null ? "." : `; ${removed} it no longer names.`)
    )
  }
  const formal = yield* readArtifact(files["ja-form"], FormalLabelLine, "ja-form")
  const formalApplied = yield* applyFormalLabels(db, formal?.lines ?? [])
  yield* report(files["ja-form"], formal !== null, formalApplied, "formal labels", "Kotori's formal labels")
  for (const language of ["ja", "en"] as const) {
    const pass = `cautions-${language}` as const
    const file = yield* readArtifact(files[pass], CautionLine, pass)
    const applied = yield* applyCautions(db, language, file?.lines ?? [])
    yield* report(files[pass], file !== null, applied, "cautions", "Kotori's cautions")
  }
  const loans = yield* readArtifact(files.loans, LoanLine, "loans")
  const loansApplied = yield* applyLoanVerdicts(db, loans?.lines ?? [])
  yield* report(files.loans, loans !== null, loansApplied, "loan verdicts changed", "Kotori's verdicts", "pairs")
})
