import { Claude, interpretTriage } from "@kotori/ai"
import {
  AiUnavailable,
  type DraftEntry,
  type DraftSense,
  EntryRecord,
  type FormRecord,
  type SenseRecord
} from "@kotori/contracts"
import { entries, EntryId, FIRST_APPROVED_JA_ID, FIRST_ENGLISH_ID, proposalAsks, proposals, users } from "@kotori/db"
import { and, asc, count, desc, eq, gte, inArray, max } from "drizzle-orm"
import { Effect, FileSystem, Option, Schema } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { authUsers } from "../../db/neonAuth.ts"
import { APPROVED_EN_FILE, serializeApprovedLine } from "../dictionary/import/eiwa/approved.ts"
import { toConsolidatedWord } from "../dictionary/import/eiwa/words.ts"
import { findForms, getEntries, insertEntries } from "../dictionary/queries.ts"
import { enqueueJob, type JobKind, saveSenseNotes } from "../enrichment/index.ts"
import type { SenseNoteInput } from "../enrichment/queries.ts"
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
  Schema.Struct({ entry: EntryRecord }),
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

/** A draft sense as the dictionary stores senses; the note is kept apart (see `approveProposal`). */
const toSense = (sense: DraftSense, extraMisc: ReadonlyArray<string>): SenseRecord => ({
  glosses: sense.glosses.map((text) => ({ text, type: null })),
  pos: sense.partOfSpeech === null ? [] : [sense.partOfSpeech],
  misc: [...new Set([...sense.labels, ...extraMisc])],
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

/** The usage tags a draft's currency adds, mirroring how the dictionary marks datedness. */
const currencyMisc = (draft: DraftEntry): ReadonlyArray<string> =>
  draft.currency === "archaic" ? ["arch"] : draft.currency === "dated" ? ["dated"] : []

/** The familiarity a draft's currency implies, for the import's priority floors. */
const currencyFamiliarity = (draft: DraftEntry): number =>
  draft.currency === "archaic" ? 1 : draft.currency === "dated" ? 2 : 4

/** The entry a draft becomes, in the language's record shape, with the given id. */
export const draftToRecord = (draft: DraftEntry, language: "en" | "ja", id: EntryId): EntryRecord => {
  const extra = currencyMisc(draft)
  const spellings = [...new Set(draft.spellings.filter((text) => text !== draft.headword))]
  return {
    id,
    language,
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
    senses: draft.senses.map((sense) => toSense(sense, extra))
  }
}

/** A proposal as stored. */
export type Proposal = typeof proposals.$inferSelect

/** The statuses `listProposals` filters by, and `all`. */
export const PROPOSAL_FILTERS = ["pending", "linked", "rejected", "approved", "discarded", "all"] as const
export type ProposalFilter = (typeof PROPOSAL_FILTERS)[number]

/**
 * Proposals newest first, each with how many learners asked for it; `contested` keeps only the
 * rejections Claude made of queries Jev was sure were lookups.
 */
export const listProposals = Effect.fn("review.listProposals")(function* (
  db: DatabaseShape,
  options: { readonly status: ProposalFilter; readonly contested?: boolean; readonly limit?: number }
) {
  return yield* db
    .select({ proposal: proposals, asks: count(proposalAsks.userId) })
    .from(proposals)
    .leftJoin(proposalAsks, eq(proposalAsks.proposalId, proposals.id))
    .where(
      and(
        options.status === "all" ? undefined : eq(proposals.status, options.status),
        options.contested === true ? eq(proposals.contested, true) : undefined
      )
    )
    .groupBy(proposals.id)
    .orderBy(desc(proposals.createdAt))
    .limit(options.limit ?? 200)
    .pipe(Effect.orDie)
})

/** How many proposals there are by status, and how many rejections are contested. */
export const proposalCounts = Effect.fn("review.proposalCounts")(function* (db: DatabaseShape) {
  const rows = yield* db
    .select({ status: proposals.status, contested: proposals.contested, n: count() })
    .from(proposals)
    .groupBy(proposals.status, proposals.contested)
    .pipe(Effect.orDie)
  const counts = { pending: 0, linked: 0, rejected: 0, approved: 0, discarded: 0, all: 0, contested: 0 }
  for (const row of rows) {
    counts[row.status] += row.n
    counts.all += row.n
    if (row.contested && row.status === "rejected") counts.contested += row.n
  }
  return counts
})

/**
 * Everyone who asked for a proposal, first asker first, with the identity they signed up with (null
 * once deleted) and their profile's name and language. The proposal's `requestedBy` is whose ask
 * drafted it.
 */
export const proposalAskers = (db: DatabaseShape, id: number) =>
  db
    .select({
      userId: proposalAsks.userId,
      askedAt: proposalAsks.createdAt,
      email: authUsers.email,
      name: authUsers.name,
      displayName: users.displayName,
      nativeLanguage: users.nativeLanguage
    })
    .from(proposalAsks)
    .leftJoin(users, eq(users.id, proposalAsks.userId))
    .leftJoin(authUsers, eq(authUsers.id, proposalAsks.userId))
    .where(eq(proposalAsks.proposalId, id))
    .orderBy(asc(proposalAsks.createdAt))
    .pipe(Effect.orDie)

/** Whose ask drafted each of the proposals: their sign-up identity (null once deleted) and profile name. */
export const drafters = (db: DatabaseShape, ids: ReadonlyArray<number>) =>
  ids.length === 0
    ? Effect.succeed([])
    : db
        .select({
          proposalId: proposals.id,
          email: authUsers.email,
          name: authUsers.name,
          displayName: users.displayName
        })
        .from(proposals)
        .leftJoin(users, eq(users.id, proposals.requestedBy))
        .leftJoin(authUsers, eq(authUsers.id, proposals.requestedBy))
        .where(inArray(proposals.id, [...ids]))
        .pipe(Effect.orDie)

export const proposalById = Effect.fn("review.proposalById")(function* (db: DatabaseShape, id: number) {
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

/** The enrichment an approved entry gets queued for, ahead of the backfill. */
const APPROVED_JOBS: ReadonlyArray<JobKind> = ["nuance", "examples", "audio"]
const APPROVED_JOB_PRIORITY = 500

/** The form an alias adds to its entry: a spelling in English, kana or kanji in Japanese. */
const aliasForm = (text: string, language: "en" | "ja"): FormRecord => ({
  kind: language === "en" ? "spelling" : kanaOnly.test(text) ? "kana" : "kanji",
  text,
  common: false,
  tags: [],
  priorities: [],
  restrictions: [],
  noKanji: false
})

/**
 * What approving a pending draft does, worked out without doing it: `approveProposal` applies it,
 * and the admin console shows it beforehand, so the preview is what approval writes.
 */
export type ApprovalPlan =
  | {
      readonly kind: "entry"
      readonly proposal: Proposal
      /** The new entry. Its id is the next free one in the language's range when planned. */
      readonly record: EntryRecord
      /** The draft's notes, kept with the entry's other sense notes rather than on its senses. */
      readonly notes: ReadonlyArray<SenseNoteInput>
      /** The enrichment queued for the entry. */
      readonly jobs: ReadonlyArray<JobKind>
      /** The approved file the entry is appended to, so reseeds and fresh databases keep it, and its line. */
      readonly file: string
      readonly line: string
    }
  | {
      readonly kind: "alias"
      readonly proposal: Proposal
      /** The existing entry the alias becomes a form of. */
      readonly base: EntryRecord
      readonly alias: string
      /** The form the entry gains, or undefined when it already has the alias, so only the file and the proposal change. */
      readonly form: FormRecord | undefined
      readonly file: string
      readonly line: string
    }

/** Works out what approving the pending proposal `id` would do; see `ApprovalPlan`. */
export const planApproval = Effect.fn("review.planApproval")(function* (
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

  if (approval.aliasOf !== undefined) {
    const matches = yield* findForms(db, [approval.aliasOf], language)
    const base = matches.find((match) => match.kind !== "inflection")
    if (base === undefined) return yield* new NoSuchAlias({ text: approval.aliasOf })
    const alias = approval.headword ?? proposal.draft.headword
    const [record] = yield* getEntries(db, [base.entryId])
    if (record === undefined) return yield* new NoSuchAlias({ text: approval.aliasOf })
    const existingForms = yield* findForms(db, [alias], language)
    const plan: ApprovalPlan = {
      kind: "alias",
      proposal,
      base: record,
      alias,
      form: existingForms.some((match) => match.entryId === base.entryId) ? undefined : aliasForm(alias, language),
      file,
      line:
        language === "en"
          ? serializeApprovedLine({ alias: { text: alias, base: approval.aliasOf } })
          : `${encodeJaLine({ alias: { text: alias, base: approval.aliasOf } })}\n`
    }
    return plan
  }

  const draft = approval.headword === undefined ? proposal.draft : { ...proposal.draft, headword: approval.headword }
  const record = draftToRecord(draft, language, yield* nextEntryId(db, language))
  const plan: ApprovalPlan = {
    kind: "entry",
    proposal,
    record,
    notes: draft.senses.flatMap((sense, index) =>
      sense.note === null
        ? []
        : [
            {
              sense: index,
              note: language === "ja" ? sense.note : null,
              noteJa: language === "en" ? sense.note : null,
              model: proposal.model
            }
          ]
    ),
    jobs: APPROVED_JOBS,
    file,
    line:
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
              familiarity: currencyFamiliarity(draft)
            }
          })
        : `${encodeJaLine({ entry: record })}\n`
  }
  return plan
})

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
  const plan = yield* planApproval(db, id, files, approval)
  const now = new Date()
  const markApproved = (linkedEntryId: EntryId) =>
    db
      .update(proposals)
      .set({ status: "approved", linkedEntryId, reviewedAt: now })
      .where(eq(proposals.id, id))
      .pipe(Effect.orDie)

  if (plan.kind === "alias") {
    // The alias joins the entry's forms now, and the approved file replays it on every import.
    if (plan.form !== undefined) yield* insertEntries(db, [{ ...plan.base, forms: [...plan.base.forms, plan.form] }])
    yield* appendLine(plan.file, plan.line)
    yield* markApproved(plan.base.id)
    return { entryId: plan.base.id, headword: plan.base.headword, alias: plan.alias }
  }

  yield* insertEntries(db, [plan.record])
  yield* saveSenseNotes(db, plan.record.id, plan.notes, now)
  for (const kind of plan.jobs) yield* enqueueJob(db, kind, plan.record.id, APPROVED_JOB_PRIORITY, now)
  yield* appendLine(plan.file, plan.line)
  yield* markApproved(plan.record.id)
  return { entryId: plan.record.id, headword: plan.record.headword, alias: null }
})

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
): { readonly records: Array<EntryRecord>; readonly aliases: Array<{ text: string; base: string }> } => {
  const records: Array<EntryRecord> = []
  const aliases: Array<{ text: string; base: string }> = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const decoded = decodeJaLine(line)
    if (Option.isNone(decoded)) continue
    if ("entry" in decoded.value) records.push(decoded.value.entry)
    else aliases.push(decoded.value.alias)
  }
  return { records, aliases }
}

export { APPROVED_EN_FILE }
