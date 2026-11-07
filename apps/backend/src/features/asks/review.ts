import { Claude, interpretTriage } from "@kotori/ai"
import { AiUnavailable, EntryRecord, type SenseRecord } from "@kotori/contracts"
import {
  DraftPitfall,
  type DraftEntry,
  type DraftSense,
  entries,
  EntryId,
  FIRST_APPROVED_JA_ID,
  FIRST_ENGLISH_ID,
  proposals
} from "@kotori/db"
import { and, eq, gte, max } from "drizzle-orm"
import { Effect, FileSystem, Option, Schema } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { APPROVED_EN_FILE, serializeApprovedLine } from "../dictionary/import/eiwa/approved.ts"
import { toConsolidatedWord } from "../dictionary/import/eiwa/words.ts"
import type { ImportEntry, SeedEvidence } from "../dictionary/import/seedFacts.ts"
import { findForms, getEntries, insertEntries, saveKotoriPitfalls } from "../dictionary/queries.ts"
import { enqueueJob } from "../enrichment/index.ts"
import { judge } from "./judge.ts"
import { updateVerdict } from "./queries.ts"

/**
 * `data/approved/ja.jsonl`: Japanese entries and aliases approved out of Ask Kotori proposals,
 * committed so a fresh database gets them too (`kotori seed` applies it after JMDict; a reseed
 * never deletes them, as the JMDict import removes nothing). Entries carry their ids, from
 * 200,000,000 up — above JMDict's sequence numbers and apart from the English dictionary's
 * 100,000,000 block — so every environment numbers them alike.
 */
export const APPROVED_JA_FILE = "data/approved/ja.jsonl"

export const ApprovedJaLine = Schema.Union([
  Schema.Struct({
    entry: EntryRecord,
    /** How familiar the word is to natives, 1–5, as the draft judged it: its only evidence of use. */
    familiarity: Schema.optional(Schema.Int),
    pitfalls: Schema.optional(Schema.Array(DraftPitfall))
  }),
  Schema.Struct({ alias: Schema.Struct({ text: Schema.String, base: Schema.String }) })
])
export type ApprovedJaLine = typeof ApprovedJaLine.Type

const decodeJaLine = Schema.decodeUnknownOption(Schema.fromJsonString(ApprovedJaLine))
const encodeJaLine = Schema.encodeSync(Schema.fromJsonString(ApprovedJaLine))

export class NoSuchProposal extends Schema.TaggedError<NoSuchProposal>()("NoSuchProposal", {
  id: Schema.Int
}) {}

export class NotPending extends Schema.TaggedError<NotPending>()("NotPending", {
  id: Schema.Int,
  status: Schema.String
}) {}

export class NotRejected extends Schema.TaggedError<NotRejected>()("NotRejected", {
  id: Schema.Int,
  status: Schema.String
}) {}

export class NoSuchAlias extends Schema.TaggedError<NoSuchAlias>()("NoSuchAlias", {
  text: Schema.String
}) {}

const kanaOnly = /^[\u3040-\u30ffー]+$/u

/** A drafted word's evidence of use: the familiarity Claude judged, nothing counted. */
const draftEvidence = (familiarity: number): SeedEvidence => ({ everyday: false, spokenCount: null, familiarity })

/**
 * A draft sense as the dictionary stores senses: its labels as usage codes and its patterns as
 * notes, which the import reads back as labels and patterns with the entry's source, Kotori.
 */
const toSense = (sense: DraftSense): SenseRecord => ({
  glosses: sense.glosses.map((text) => ({ text, type: null })),
  pos: [...sense.pos],
  misc: [...sense.labels],
  fields: [],
  dialects: [],
  info: [...sense.patterns],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  sources: [],
  wasei: false
})

/** The entry a draft becomes, in the language's record shape, with the given id. */
export const draftToRecord = (draft: DraftEntry, language: "en" | "ja", id: EntryId): EntryRecord => {
  const spellings = [...new Set(draft.spellings.filter((text) => text !== draft.headword))]
  return {
    id,
    language,
    dictionary: "kotori",
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

const proposalById = Effect.fn("review.proposalById")(function* (db: DatabaseShape, id: number) {
  const rows = yield* db.select().from(proposals).where(eq(proposals.id, id)).pipe(Effect.orDie)
  if (rows[0] === undefined) return yield* new NoSuchProposal({ id })
  return rows[0]
})

const nextEntryId = Effect.fn("review.nextEntryId")(function* (db: DatabaseShape, language: "en" | "ja") {
  const from = EntryId.make(language === "en" ? FIRST_ENGLISH_ID : FIRST_APPROVED_JA_ID)
  const [row] = yield* db
    .select({ top: max(entries.id) })
    .from(entries)
    .where(and(eq(entries.language, language), gte(entries.id, from)))
    .pipe(Effect.orDie)
  return EntryId.make(Math.max(row?.top ?? 0, from) + 1)
})

const appendLine = Effect.fnUntraced(function* (file: string, line: string) {
  const fs = yield* FileSystem.FileSystem
  const dir = file.slice(0, file.lastIndexOf("/"))
  yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
  const existing = (yield* fs.exists(file).pipe(Effect.orDie)) ? yield* fs.readFileString(file).pipe(Effect.orDie) : ""
  yield* fs.writeFileString(file, existing + line).pipe(Effect.orDie)
})

export interface ApprovedFiles {
  readonly en: string
  readonly ja: string
}

export interface Approval {
  /** Approve as a way an existing entry is written instead of a new entry: the entry's headword. */
  readonly aliasOf?: string | undefined
  /** Replace the draft's headword. */
  readonly headword?: string | undefined
}

/**
 * Turns a pending draft into a real dictionary entry (or an extra spelling of one), appends it to
 * the language's approved file so reseeds and fresh databases keep it, queues its enrichment, and
 * marks the proposal approved and linked for everyone who asked.
 */
export const approveProposal = Effect.fn("review.approveProposal")(function* (
  db: DatabaseShape,
  id: number,
  files: ApprovedFiles,
  approval: Approval = {}
) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "pending" || proposal.draft === null) {
    return yield* new NotPending({ id, status: proposal.status })
  }
  const language = proposal.language
  const file = language === "en" ? files.en : files.ja
  const now = new Date()

  if (approval.aliasOf !== undefined) {
    const matches = yield* findForms(db, [approval.aliasOf], language)
    const base = matches.find((match) => match.kind !== "inflection")
    if (base === undefined) return yield* new NoSuchAlias({ text: approval.aliasOf })
    const alias = approval.headword ?? proposal.draft.headword
    const [record] = yield* getEntries(db, [base.entryId])
    if (record === undefined) return yield* new NoSuchAlias({ text: approval.aliasOf })
    // The alias joins the entry's forms now, and the approved file replays it on every import.
    const existingForms = yield* findForms(db, [alias], language)
    if (!existingForms.some((match) => match.entryId === base.entryId)) {
      yield* appendAliasForm(db, record, alias, language)
    }
    yield* appendLine(
      file,
      language === "en"
        ? serializeApprovedLine({ alias: { text: alias, base: approval.aliasOf } })
        : `${encodeJaLine({ alias: { text: alias, base: approval.aliasOf } })}\n`
    )
    yield* db
      .update(proposals)
      .set({ status: "approved", linkedEntryId: base.entryId, reviewedAt: now })
      .where(eq(proposals.id, id))
      .pipe(Effect.orDie)
    return { entryId: base.entryId, headword: record.headword, alias }
  }

  const draft = approval.headword === undefined ? proposal.draft : { ...proposal.draft, headword: approval.headword }
  const entryId = yield* nextEntryId(db, language)
  const record = draftToRecord(draft, language, entryId)
  // Seeded, so the draft's familiarity is the word's evidence of use from the start.
  yield* insertEntries(db, [{ ...record, evidence: draftEvidence(draft.familiarity) }], { seeded: true })
  yield* saveKotoriPitfalls(db, entryId, language, draft.pitfalls)
  for (const kind of ["nuance", "examples", "audio"] as const) yield* enqueueJob(db, kind, entryId, 500, now)
  yield* appendLine(
    file,
    language === "en"
      ? serializeApprovedLine({
          entry: {
            ...toConsolidatedWord({
              headword: draft.headword,
              ipa: draft.reading.length > 0 ? draft.reading : null,
              spellings: draft.spellings.filter((text) => text !== draft.headword),
              inflections: [],
              senses: record.senses
            }),
            familiarity: draft.familiarity
          },
          ...(draft.pitfalls.length > 0 ? { pitfalls: draft.pitfalls } : {})
        })
      : `${encodeJaLine({
          entry: record,
          familiarity: draft.familiarity,
          ...(draft.pitfalls.length > 0 ? { pitfalls: draft.pitfalls } : {})
        })}\n`
  )
  yield* db
    .update(proposals)
    .set({ status: "approved", linkedEntryId: entryId, reviewedAt: now })
    .where(eq(proposals.id, id))
    .pipe(Effect.orDie)
  return { entryId, headword: draft.headword, alias: null }
})

/** Adds a spelling (or kana/kanji form) to an existing entry without touching the rest of it. */
const appendAliasForm = (db: DatabaseShape, record: EntryRecord, text: string, language: "en" | "ja") => {
  const kind = language === "en" ? ("spelling" as const) : kanaOnly.test(text) ? ("kana" as const) : ("kanji" as const)
  return insertEntries(db, [
    {
      ...record,
      forms: [
        ...record.forms,
        { kind, text, common: false, tags: [], priorities: [], restrictions: [], noKanji: false }
      ]
    }
  ])
}

/** Turns a pending draft down; the row stays, so the query isn't generated (or asked about) again. */
export const discardProposal = Effect.fn("review.discardProposal")(function* (
  db: DatabaseShape,
  id: number,
  reason: string | null
) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "pending") return yield* new NotPending({ id, status: proposal.status })
  yield* db
    .update(proposals)
    .set({ status: "discarded", reason, reviewedAt: new Date() })
    .where(eq(proposals.id, id))
    .pipe(Effect.orDie)
  return { query: proposal.query }
})

/**
 * Asks Claude again about a rejected query, replacing the answer: the admin's remedy for a wrong
 * rejection, Claude's or Jev's. Claude's answer stands whatever Jev routed, so the route becomes
 * a lookup, and the app shows Claude's verdict rather than Jev's pointer.
 */
export const redoProposal = Effect.fn("review.redoProposal")(function* (db: DatabaseShape, id: number) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "rejected") return yield* new NotRejected({ id, status: proposal.status })
  const claude = yield* Claude
  if (!(yield* claude.available)) return yield* new AiUnavailable({ message: "Claude isn't available right now." })
  const triaged =
    proposal.triage === null ? null : { record: proposal.triage, reading: interpretTriage(proposal.triage.answers) }
  const updated = yield* updateVerdict(db, id, yield* judge(db, proposal.query, proposal.language, triaged))
  const [linked] = updated.linkedEntryId === null ? [] : yield* getEntries(db, [updated.linkedEntryId])
  return { proposal: updated, linked: linked?.headword ?? null }
})

/** The approved ja file's entries and aliases; see `APPROVED_JA_FILE`. */
export const parseApprovedJa = (
  lines: Iterable<string>
): {
  /** Entries with the familiarity they were approved with, if their line carries one. */
  readonly records: Array<ImportEntry>
  readonly pitfalls: Array<{ readonly entryId: EntryId; readonly pitfalls: ReadonlyArray<DraftPitfall> }>
  readonly aliases: Array<{ text: string; base: string }>
} => {
  const records: Array<ImportEntry> = []
  const pitfalls: Array<{ readonly entryId: EntryId; readonly pitfalls: ReadonlyArray<DraftPitfall> }> = []
  const aliases: Array<{ text: string; base: string }> = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const decoded = decodeJaLine(line)
    if (Option.isNone(decoded)) continue
    if ("entry" in decoded.value) {
      const { entry, familiarity } = decoded.value
      records.push(familiarity === undefined ? entry : { ...entry, evidence: draftEvidence(familiarity) })
      if (decoded.value.pitfalls !== undefined) {
        pitfalls.push({ entryId: decoded.value.entry.id, pitfalls: decoded.value.pitfalls })
      }
    } else aliases.push(decoded.value.alias)
  }
  return { records, pitfalls, aliases }
}

export { APPROVED_EN_FILE }
