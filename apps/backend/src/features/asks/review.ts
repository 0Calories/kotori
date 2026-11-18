import { Claude, interpretTriage } from "@kotori/ai"
import { AiUnavailable, type EntryCaution, EntryRecord, SenseRecord } from "@kotori/contracts"
import { DraftCaution, type EntryId, proposals } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Effect, FileSystem, Option, Schema } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import {
  deleteEntries,
  findForms,
  getEntries,
  insertEntries,
  reviewEntries,
  type StoredEntry
} from "../dictionary/index.ts"
import { APPROVED_EN_FILE, serializeApprovedLine } from "../dictionary/import/english/approved.ts"
import { toConsolidatedWord } from "../dictionary/import/english/words.ts"
import type { ImportEntry } from "../dictionary/import/seedFacts.ts"
import { cautionsFor, frequencyFor } from "../dictionary/usage.ts"
import { enqueueJob } from "../enrichment/index.ts"
import { draftFrequency, draftToRecord, kanaOnly, writeDraftedEntry } from "./draft.ts"
import { judge } from "./judge.ts"
import { moveNotes, repointProposals, standing, updateVerdict } from "./queries.ts"

export const APPROVED_JA_FILE = "data/approved/ja.jsonl"

const ApprovedJaSense = Schema.Struct({
  ...SenseRecord.fields,
  origins: SenseRecord.fields.origins.pipe(Schema.withDecodingDefaultKey(Effect.succeed([] as const)))
})

// Lines written before source tracking default to "kotori".
const ApprovedJaEntry = Schema.Struct({
  ...EntryRecord.fields,
  source: EntryRecord.fields.source.pipe(Schema.withDecodingDefaultKey(Effect.succeed("kotori" as const))),
  senses: Schema.Array(ApprovedJaSense)
})

export const ApprovedJaLine = Schema.Union([
  Schema.Struct({
    entry: ApprovedJaEntry,
    frequency: Schema.optional(Schema.Int),
    cautions: Schema.optional(Schema.Array(DraftCaution))
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

const renamed = (entry: StoredEntry, headword: string): StoredEntry => {
  const spellings = entry.forms
    .filter((form) => form.kind !== "inflection" && form.text !== entry.headword && form.text !== entry.reading)
    .map((form) => form.text)
  const { forms } = draftToRecord(
    { headword, reading: entry.reading, spellings, frequency: 1, senses: [], cautions: [] },
    entry.language,
    entry.id
  )
  return { ...entry, headword, forms }
}

const draftedCautions = (cautions: ReadonlyArray<EntryCaution>): Array<DraftCaution> =>
  cautions
    .filter((caution) => caution.source === "kotori")
    .map((caution) => ({
      kind: caution.kind,
      text: caution.text,
      sense: caution.sense,
      about: caution.about?.headword ?? null
    }))

const proposalById = Effect.fn("review.proposalById")(function* (db: DatabaseShape, id: number) {
  const rows = yield* db.select().from(proposals).where(eq(proposals.id, id)).pipe(Effect.orDie)
  if (rows[0] === undefined) return yield* new NoSuchProposal({ id })
  return rows[0]
})

const pendingDraftedEntry = Effect.fn("review.pendingDraftedEntry")(function* (db: DatabaseShape, id: number) {
  const proposal = yield* proposalById(db, id)
  const [entry] = proposal.entryId === null ? [] : yield* getEntries(db, [proposal.entryId])
  const status = standing(proposal.status, entry?.review ?? "gone")
  if (status !== "pending" || entry === undefined) return yield* new NotPending({ id, status })
  return { proposal, entry }
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
  readonly aliasOf?: string | undefined
  readonly headword?: string | undefined
}

export const approveProposal = Effect.fn("review.approveProposal")(function* (
  db: DatabaseShape,
  id: number,
  files: ApprovedFiles,
  approval: Approval = {}
) {
  const { entry: drafted } = yield* pendingDraftedEntry(db, id)
  const language = drafted.language
  const file = language === "en" ? files.en : files.ja
  const now = new Date()

  if (approval.aliasOf !== undefined) {
    const matches = yield* findForms(db, [approval.aliasOf], language)
    const base = matches.find((match) => match.kind !== "inflection")
    if (base === undefined) return yield* new NoSuchAlias({ text: approval.aliasOf })
    const alias = approval.headword ?? drafted.headword
    const [record] = yield* getEntries(db, [base.entryId])
    if (record === undefined) return yield* new NoSuchAlias({ text: approval.aliasOf })
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
    yield* moveNotes(db, drafted.id, base.entryId)
    yield* repointProposals(db, drafted.id, base.entryId, now)
    yield* deleteEntries(db, [drafted.id])
    return { entryId: base.entryId, headword: record.headword, alias }
  }

  const entry = approval.headword === undefined ? drafted : renamed(drafted, approval.headword)
  // Omit { seeded: true } so insertEntries preserves the frequency score stored when the entry was drafted.
  if (entry !== drafted) yield* insertEntries(db, [entry])
  yield* reviewEntries(db, [entry.id], "approve")
  for (const kind of ["examples", "audio"] as const) yield* enqueueJob(db, kind, entry.id, 500, now)
  const frequency = (yield* frequencyFor(db, entry.id))?.score ?? undefined
  const cautions = draftedCautions(yield* cautionsFor(db, entry.id))
  const { review: _, ...record } = entry
  yield* appendLine(
    file,
    language === "en"
      ? serializeApprovedLine({
          entry: {
            ...toConsolidatedWord({
              headword: record.headword,
              ipa: record.reading.length > 0 ? record.reading : null,
              spellings: record.forms
                .filter((form) => form.kind === "spelling" && form.text !== record.headword)
                .map((form) => form.text),
              inflections: [],
              senses: record.senses
            }),
            ...(frequency === undefined ? {} : { frequency })
          },
          ...(cautions.length > 0 ? { cautions } : {})
        })
      : `${encodeJaLine({
          entry: record,
          ...(frequency === undefined ? {} : { frequency }),
          ...(cautions.length > 0 ? { cautions } : {})
        })}\n`
  )
  yield* db.update(proposals).set({ reviewedAt: now }).where(eq(proposals.entryId, entry.id)).pipe(Effect.orDie)
  return { entryId: entry.id, headword: entry.headword, alias: null }
})

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

export const discardProposal = Effect.fn("review.discardProposal")(function* (
  db: DatabaseShape,
  id: number,
  reason: string | null
) {
  const { proposal, entry } = yield* pendingDraftedEntry(db, id)
  yield* reviewEntries(db, [entry.id], "discard")
  yield* db.update(proposals).set({ reason, reviewedAt: new Date() }).where(eq(proposals.id, id)).pipe(Effect.orDie)
  return { query: proposal.query }
})

export const redoProposal = Effect.fn("review.redoProposal")(function* (db: DatabaseShape, id: number) {
  const proposal = yield* proposalById(db, id)
  if (proposal.status !== "rejected") return yield* new NotRejected({ id, status: proposal.status })
  const claude = yield* Claude
  if (!(yield* claude.available)) return yield* new AiUnavailable({ message: "Claude isn't available right now." })
  const triaged =
    proposal.triage === null ? null : { record: proposal.triage, reading: interpretTriage(proposal.triage.answers) }
  const { draft, ...verdict } = yield* judge(db, proposal.query, proposal.language, triaged)
  const entryId = draft === null ? verdict.entryId : yield* writeDraftedEntry(db, draft, proposal.language)
  const updated = yield* updateVerdict(db, id, { ...verdict, entryId })
  const [named] = updated.entryId === null ? [] : yield* getEntries(db, [updated.entryId])
  return { proposal: updated, headword: named?.headword ?? null }
})

export const parseApprovedJa = (
  lines: Iterable<string>
): {
  readonly records: Array<ImportEntry>
  readonly cautions: Array<{
    readonly entryId: EntryId
    readonly cautions: ReadonlyArray<DraftCaution>
  }>
  readonly aliases: Array<{ text: string; base: string }>
  readonly skipped: Array<number>
} => {
  const records: Array<ImportEntry> = []
  const cautions: Array<{
    readonly entryId: EntryId
    readonly cautions: ReadonlyArray<DraftCaution>
  }> = []
  const aliases: Array<{ text: string; base: string }> = []
  const skipped: Array<number> = []
  let number = 0
  for (const line of lines) {
    number++
    if (line.trim().length === 0) continue
    const decoded = decodeJaLine(line)
    if (Option.isNone(decoded)) {
      skipped.push(number)
      continue
    }
    if ("entry" in decoded.value) {
      const { entry, frequency } = decoded.value
      records.push(frequency === undefined ? entry : { ...entry, frequency: draftFrequency(frequency) })
      if (decoded.value.cautions !== undefined) {
        cautions.push({ entryId: decoded.value.entry.id, cautions: decoded.value.cautions })
      }
    } else aliases.push(decoded.value.alias)
  }
  return { records, cautions, aliases, skipped }
}

export { APPROVED_EN_FILE }
