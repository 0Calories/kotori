import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import type { EntryRecord } from "@kotori/contracts"
import { Effect, Exit } from "effect"
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react"
import { Database } from "../../db/Database.ts"
import {
  APPROVED_EN_FILE,
  APPROVED_JA_FILE,
  type ApprovalPlan,
  approveProposal,
  discardProposal,
  drafters,
  listProposals,
  type Proposal,
  proposalAskers,
  proposalCounts,
  type ProposalFilter,
  planApproval,
  redoProposal
} from "../../features/asks/review.ts"
import { getEntries, tagLabels } from "../../features/dictionary/index.ts"
import { resolveFromRoot } from "../../runtime/Paths.ts"
import { describeCause } from "../model/describe.ts"
import { ago, plural, since, truncate } from "../model/format.ts"
import { type Column, Hints, Panel, Row, Scroll, Spinner, Status, Table, Tabs, useNow } from "../ui/components.tsx"
import { useConsole, useViewSize } from "../ui/context.tsx"
import { Filter, useFilter } from "../ui/filter.tsx"
import { Layer, moveIn, useKeys } from "../ui/keys.tsx"
import { Modal, TargetLine, useOverlay } from "../ui/overlay.tsx"
import { invalidate, useQuery } from "../ui/query.ts"
import { color, symbol } from "../ui/theme.ts"
import { ApprovalPreview, DraftCard, type TagLabels } from "./EntryPreview.tsx"

const files = { en: resolveFromRoot(APPROVED_EN_FILE), ja: resolveFromRoot(APPROVED_JA_FILE) }

type Counts = Effect.Success<ReturnType<typeof proposalCounts>>

const TABS: ReadonlyArray<{
  readonly label: string
  readonly status: ProposalFilter
  readonly contested: boolean
  readonly count: keyof Counts
}> = [
  { label: "Pending", status: "pending", contested: false, count: "pending" },
  { label: "Contested", status: "rejected", contested: true, count: "contested" },
  { label: "Rejected", status: "rejected", contested: false, count: "rejected" },
  { label: "Linked", status: "linked", contested: false, count: "linked" },
  { label: "Approved", status: "approved", contested: false, count: "approved" },
  { label: "Discarded", status: "discarded", contested: false, count: "discarded" },
  { label: "All", status: "all", contested: false, count: "all" }
]

interface Listed {
  readonly proposal: Proposal
  readonly asks: number
}

type Asker = Effect.Success<ReturnType<typeof proposalAskers>>[number]

interface Detail {
  readonly askers: Exit.Exit<ReadonlyArray<Asker>, unknown>
  readonly linked: EntryRecord | undefined
  readonly plan: Exit.Exit<ApprovalPlan, unknown> | undefined
}

const statusColor: Readonly<Record<string, string>> = {
  pending: color.warn,
  linked: color.sky,
  rejected: color.accent,
  approved: color.ok,
  discarded: color.faint
}

const headline = (proposal: Proposal) =>
  proposal.draft !== null && proposal.draft.headword !== proposal.query
    ? `${proposal.query} ${symbol.arrow} ${proposal.draft.headword}`
    : proposal.query

const speaker = (language: string | null) =>
  language === "ja" ? "Japanese speaker" : language === "en" ? "English speaker" : "no profile"

/** Who asked, with the learner whose ask drafted it marked; their identity, or a note that it's gone. */
const AskedBy = ({ proposal, askers }: { readonly proposal: Proposal; readonly askers: Detail["askers"] }) => {
  const now = useNow(30_000)
  if (Exit.isFailure(askers)) {
    return <text fg={color.danger}>{`Couldn't read who asked: ${describeCause(askers.cause)}`}</text>
  }
  const rows = askers.value
  const drafter = rows.some((asker) => asker.userId === proposal.requestedBy)
  return (
    <box flexDirection="column">
      {rows.length === 0 ? <text fg={color.muted}>Nobody has an ask on it any more.</text> : null}
      {rows.map((asker) => {
        const name = asker.name?.trim() || asker.displayName?.trim() || "no name"
        const drafted = asker.userId === proposal.requestedBy
        return (
          <box key={asker.userId} flexDirection="row" flexShrink={0}>
            <box width={2} flexShrink={0}>
              <text fg={drafted ? color.accent : color.faint}>{drafted ? symbol.sparkle : symbol.dot}</text>
            </box>
            <box flexDirection="column" flexGrow={1} flexShrink={1}>
              <text>
                <span fg={color.text} attributes={TextAttributes.BOLD}>
                  {name}
                </span>
                <span
                  fg={asker.email === null ? color.faint : color.text}
                >{`  ${asker.email ?? "account deleted"}`}</span>
                {drafted ? <span fg={color.accent}>{"  drafted it"}</span> : null}
              </text>
              <text
                fg={color.muted}
              >{`${speaker(asker.nativeLanguage)}  ${symbol.dot}  asked ${since(asker.askedAt, now)}`}</text>
            </box>
          </box>
        )
      })}
      {proposal.requestedBy === null ? (
        <text fg={color.faint}>Whoever asked first has deleted their account.</text>
      ) : !drafter && rows.length > 0 ? (
        <text fg={color.faint}>The learner whose ask drafted it no longer has the ask.</text>
      ) : null}
    </box>
  )
}

const Section = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <box flexDirection="column" marginTop={1}>
    <text fg={color.primary} attributes={TextAttributes.BOLD}>
      {title}
    </text>
    {children}
  </box>
)

const ProposalDetail = ({
  listed,
  detail,
  labels,
  raw,
  scroll
}: {
  readonly listed: Listed
  readonly detail: ReturnType<typeof useQuery<Detail>>["result"]
  readonly labels: TagLabels
  readonly raw: boolean
  readonly scroll: RefObject<ScrollBoxRenderable | null>
}) => {
  const { proposal } = listed
  const now = useNow(30_000)
  return (
    <Scroll scroll={scroll}>
      <box flexDirection="column" paddingRight={1}>
        <text fg={color.text} attributes={TextAttributes.BOLD}>
          {headline(proposal)}
        </text>
        <text>
          <span fg={color.muted}>{proposal.language === "ja" ? "Japanese" : "English"}</span>
          <span fg={color.faint}>{`  ${symbol.dot}  `}</span>
          <span fg={statusColor[proposal.status] ?? color.text}>{proposal.status}</span>
          <span fg={color.faint}>{`  ${symbol.dot}  route ${proposal.route ?? "none (Jev wasn't asked)"}`}</span>
          {proposal.contested ? <span fg={color.accent}>{"  ! contested"}</span> : null}
        </text>
        <text fg={color.faint}>
          {`asked ${since(proposal.createdAt, now)} by ${plural(listed.asks, "learner")}  ${symbol.dot}  ${proposal.model}${proposal.reviewedAt === null ? "" : `  ${symbol.dot}  reviewed ${since(proposal.reviewedAt, now)}`}`}
        </text>
        {raw ? (
          <Section title="As stored (kotori proposals show)">
            <text fg={color.muted}>{JSON.stringify(proposal, null, 2)}</text>
          </Section>
        ) : (
          <>
            <Section title="Asked by">
              {detail.state === "ready" ? (
                <AskedBy proposal={proposal} askers={detail.value.askers} />
              ) : detail.state === "error" ? (
                <Status state="error">{detail.message}</Status>
              ) : (
                <Status state="loading">Looking up who asked…</Status>
              )}
            </Section>
            {proposal.contested ? (
              <Section title="Contested">
                <text fg={color.muted}>
                  Jev was sure this was a lookup, but Claude turned it down: worth a look for a wrong rejection. Ask
                  again with e.
                </text>
              </Section>
            ) : null}
            {proposal.reason === null ? null : (
              <Section title={proposal.status === "discarded" ? "Why it was discarded" : "Why it was turned down"}>
                <text fg={color.text}>{proposal.reason}</text>
              </Section>
            )}
            {detail.state === "ready" && detail.value.linked !== undefined ? (
              <Section title={proposal.status === "approved" ? "Approved as" : "Linked to"}>
                <text>
                  <span fg={color.text} attributes={TextAttributes.BOLD}>
                    {detail.value.linked.headword}
                  </span>
                  <span
                    fg={color.muted}
                  >{`  #${detail.value.linked.id}  ${truncate(detail.value.linked.senses.map((sense) => sense.glosses.map((gloss) => gloss.text).join(", ")).join("; "), 80)}`}</span>
                </text>
              </Section>
            ) : null}
            {proposal.draft === null ? null : (
              <Section title={proposal.status === "pending" ? "What the askers see now" : "The draft"}>
                <DraftCard draft={proposal.draft} language={proposal.language} labels={labels} />
              </Section>
            )}
            {proposal.status === "pending" && proposal.draft !== null ? (
              <Section title="Once approved">
                {detail.state !== "ready" || detail.value.plan === undefined ? (
                  <Status state="loading">Working out what approving does…</Status>
                ) : Exit.isFailure(detail.value.plan) ? (
                  <Status state="error">{describeCause(detail.value.plan.cause)}</Status>
                ) : (
                  <ApprovalPreview
                    plan={detail.value.plan.value}
                    labels={labels}
                    askers={Exit.isSuccess(detail.value.askers) ? detail.value.askers.value.length : undefined}
                  />
                )}
              </Section>
            ) : null}
          </>
        )}
      </box>
    </Scroll>
  )
}

/** The approve dialog: the headword and alias fields, and the approval they'd make, worked out live. */
const ApproveDialog = ({
  listed,
  labels,
  settle
}: {
  readonly listed: Listed
  readonly labels: TagLabels
  readonly settle: (approval: { headword: string; aliasOf: string } | undefined) => void
}) => {
  const { runtime, target } = useConsole()
  const draft = listed.proposal.draft!
  const [field, setField] = useState<"headword" | "aliasOf">("headword")
  const [values, setValues] = useState({ headword: draft.headword, aliasOf: "" })
  const [settledValues, setSettledValues] = useState(values)
  useEffect(() => {
    const id = setTimeout(() => setSettledValues(values), 250)
    return () => clearTimeout(id)
  }, [values])
  const approval = {
    headword: settledValues.headword.trim() === draft.headword ? undefined : settledValues.headword.trim(),
    aliasOf: settledValues.aliasOf.trim() === "" ? undefined : settledValues.aliasOf.trim()
  }
  const { result } = useQuery(
    `approve:${listed.proposal.id}:${approval.headword ?? ""}:${approval.aliasOf ?? ""}`,
    () =>
      runtime.services.database.run(
        Effect.gen(function* () {
          return yield* planApproval(yield* Database, listed.proposal.id, files, approval)
        })
      )
  )
  const current = values.headword === settledValues.headword && values.aliasOf === settledValues.aliasOf
  const ready = current && result.state === "ready" && !result.refreshing && values.headword.trim().length > 0

  useKeys(
    (key) => {
      if (key.name === "escape") settle(undefined)
      else if (key.name === "tab" || key.name === "shift+tab" || key.name === "down" || key.name === "up") {
        setField((now) => (now === "headword" ? "aliasOf" : "headword"))
      } else if (key.name === "return") {
        if (ready) settle({ headword: values.headword.trim(), aliasOf: values.aliasOf.trim() })
      } else return false
      return true
    },
    { layer: Layer.dialog, modal: true }
  )

  const input = (name: "headword" | "aliasOf", placeholder: string) => (
    <box
      border
      borderStyle="rounded"
      borderColor={field === name ? color.primary : color.border}
      height={3}
      flexGrow={1}
    >
      <input
        focused={field === name}
        value={values[name]}
        placeholder={placeholder}
        onInput={(next: string) => setValues((now) => ({ ...now, [name]: next }))}
        backgroundColor={color.surface}
        focusedBackgroundColor={color.surface}
        textColor={color.text}
        focusedTextColor={color.text}
        placeholderColor={color.faint}
      />
    </box>
  )

  return (
    <Modal title={`Approve "${draft.headword}"`} width={96}>
      <box flexDirection="column" flexShrink={0}>
        <Row label="Headword" labelWidth={11}>
          {input("headword", draft.headword)}
        </Row>
        <Row label="Alias of" labelWidth={11}>
          {input("aliasOf", "leave empty for a new entry, or name the entry it's another way to write")}
        </Row>
      </box>
      <Scroll minHeight={3}>
        {result.state === "loading" || !current ? (
          <Status state="loading">Working out what approving does…</Status>
        ) : result.state === "error" ? (
          <Status state="error">
            {result.message === "NoSuchAlias" ? `No entry is written "${approval.aliasOf ?? ""}".` : result.message}
          </Status>
        ) : (
          <ApprovalPreview plan={result.value} labels={labels} askers={listed.asks} />
        )}
      </Scroll>
      <TargetLine target={target} />
      <text flexShrink={0}>
        <span
          bg={ready ? color.primarySoft : color.raised}
          fg={ready ? color.text : color.faint}
          attributes={TextAttributes.BOLD}
        >
          {" ⏎ Approve "}
        </span>
        <span fg={color.muted}>{"   tab next field   esc cancel"}</span>
      </text>
    </Modal>
  )
}

/** Ask Kotori's drafts: `kotori proposals list`, `show`, `approve`, `discard` and `redo`. */
export const Proposals = () => {
  const { runtime, refreshWaiting } = useConsole()
  const now = useNow(30_000)
  const overlay = useOverlay()
  const size = useViewSize()
  const [tab, setTab] = useState(0)
  const [index, setIndex] = useState(0)
  const [raw, setRaw] = useState(false)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const filter = useFilter()
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const chosen = TABS[tab]!

  const list = useQuery(`proposals:${chosen.label}`, () =>
    runtime.services.database.run(
      Effect.gen(function* () {
        return yield* listProposals(yield* Database, { status: chosen.status, contested: chosen.contested })
      })
    )
  )
  const counts = useQuery("proposal-counts", () =>
    runtime.services.database.run(
      Effect.gen(function* () {
        return yield* proposalCounts(yield* Database)
      })
    )
  )
  const tags = useQuery(
    "tag-labels",
    () =>
      runtime.services.database.run(
        Effect.gen(function* () {
          return yield* tagLabels(yield* Database)
        })
      ),
    Infinity
  )
  const labels: TagLabels = tags.result.state === "ready" ? tags.result.value : new Map()

  // Whose ask drafted each listed proposal, for the list's By column; a missing identity just shows —.
  const listedIds = list.result.state === "ready" ? list.result.value.map((row) => row.proposal.id) : []
  const drafted = useQuery(`drafters:${listedIds.join(",")}`, () =>
    runtime.services.database.run(
      Effect.gen(function* () {
        return yield* drafters(yield* Database, listedIds)
      })
    )
  )
  const drafterOf = new Map(
    (drafted.result.state === "ready" ? drafted.result.value : []).map((row) => [
      row.proposalId,
      row.name?.trim() || row.displayName?.trim() || row.email?.split("@")[0] || "—"
    ])
  )

  const rows: ReadonlyArray<Listed> =
    list.result.state === "ready"
      ? list.result.value.filter((row) =>
          filter.matches(`${headline(row.proposal)} ${drafterOf.get(row.proposal.id) ?? ""}`)
        )
      : []
  const at = Math.min(index, Math.max(0, rows.length - 1))
  const listed = rows[at]

  const detail = useQuery(`proposal:${listed?.proposal.id ?? "none"}:${listed?.proposal.status ?? ""}`, () =>
    listed === undefined
      ? Promise.resolve(Exit.succeed<Detail>({ askers: Exit.succeed([]), linked: undefined, plan: undefined }))
      : runtime.services.database.run(
          Effect.gen(function* () {
            const db = yield* Database
            const { proposal } = listed
            const askers = yield* Effect.exit(proposalAskers(db, proposal.id))
            const linked =
              proposal.linkedEntryId === null ? undefined : (yield* getEntries(db, [proposal.linkedEntryId]))[0]
            const plan =
              proposal.status === "pending" && proposal.draft !== null
                ? yield* Effect.exit(planApproval(db, proposal.id, files))
                : undefined
            const value: Detail = { askers, linked, plan }
            return value
          })
        )
  )

  const reloadAll = () => {
    list.reload()
    counts.reload()
    detail.reload()
    refreshWaiting()
  }

  const finish = (exit: Exit.Exit<string, unknown>, failures: Readonly<Record<string, string>>) => {
    setBusy(undefined)
    invalidate("overview-drafts")
    if (Exit.isSuccess(exit)) overlay.toast("ok", exit.value)
    else {
      const message = describeCause(exit.cause)
      overlay.toast("error", failures[message] ?? message)
    }
    reloadAll()
  }

  const approve = async (target: Listed, approval: { headword: string; aliasOf: string }) => {
    setBusy("Approving")
    const draft = target.proposal.draft!
    const exit = await runtime.services.database.run(
      Effect.gen(function* () {
        const result = yield* approveProposal(yield* Database, target.proposal.id, files, {
          headword: approval.headword === draft.headword ? undefined : approval.headword,
          aliasOf: approval.aliasOf === "" ? undefined : approval.aliasOf
        })
        return result.alias === null
          ? `Approved: entry ${result.entryId} "${result.headword}", enrichment queued, saved to the approved file. Commit it.`
          : `Approved: "${result.alias}" now a form of entry ${result.entryId} "${result.headword}", saved to the approved file. Commit it.`
      })
    )
    finish(exit, {
      NoSuchAlias: `No entry is written "${approval.aliasOf}".`,
      NotPending: `Proposal ${target.proposal.id} isn't pending any more.`
    })
  }

  const discard = async (target: Listed) => {
    const reason = await overlay.prompt({
      title: "Discard draft",
      lines: [
        `Discard "${headline(target.proposal)}"?`,
        "The answer stays as a negative cache, so it won't be drafted again."
      ],
      label: "Why, for the record (optional)",
      action: "Discard",
      writes: true
    })
    if (reason === undefined) return
    setBusy("Discarding")
    const exit = await runtime.services.database.run(
      Effect.gen(function* () {
        const result = yield* discardProposal(yield* Database, target.proposal.id, reason.trim() || null)
        return `Discarded "${result.query}"; it won't be generated again.`
      })
    )
    finish(exit, { NotPending: `Proposal ${target.proposal.id} isn't pending any more.` })
  }

  const redo = async (target: Listed) => {
    const ok = await overlay.confirm({
      title: "Ask again",
      lines: [
        `Ask Claude again about "${target.proposal.query}"?`,
        "Its answer replaces this rejection, whatever Jev routed. It costs a Claude call."
      ],
      action: "Ask again",
      writes: true
    })
    if (!ok) return
    setBusy("Asking Claude")
    const exit = await runtime.services.redo.run(
      Effect.gen(function* () {
        const { proposal, linked } = yield* redoProposal(yield* Database, target.proposal.id)
        return (
          `Asked again: proposal ${target.proposal.id} is now ${proposal.status}` +
          (proposal.draft !== null ? ` with a draft for "${proposal.draft.headword}"` : "") +
          (linked !== null ? `, linked to "${linked}"` : "") +
          (proposal.reason !== null ? `: ${proposal.reason}` : "") +
          "."
        )
      })
    )
    finish(exit, { NotRejected: `Proposal ${target.proposal.id} isn't rejected any more.` })
  }

  useKeys(
    (key) => {
      const moved = moveIn(key, at, rows.length, 10)
      if (moved !== undefined) {
        setIndex(moved)
        scroll.current?.scrollTo(0)
        return true
      }
      switch (key.name) {
        case "left":
        case "h":
          setTab((value) => (value + TABS.length - 1) % TABS.length)
          setIndex(0)
          scroll.current?.scrollTo(0)
          return true
        case "right":
        case "l":
          setTab((value) => (value + 1) % TABS.length)
          setIndex(0)
          scroll.current?.scrollTo(0)
          return true
        case "J":
        case "shift+down":
          scroll.current?.scrollBy(3)
          return true
        case "K":
        case "shift+up":
          scroll.current?.scrollBy(-3)
          return true
        case "v":
          setRaw((value) => !value)
          return true
        case "/":
          filter.open()
          return true
        case "escape":
          if (filter.text.length === 0) return false
          filter.clear()
          return true
        case "r":
          reloadAll()
          return true
        case "a":
          if (busy === undefined && listed?.proposal.status === "pending" && listed.proposal.draft !== null) {
            const target = listed
            overlay.present(
              <ApproveDialog
                listed={target}
                labels={labels}
                settle={(approval) => {
                  overlay.dismiss()
                  if (approval !== undefined) void approve(target, approval)
                }}
              />
            )
          }
          return true
        case "d":
          if (busy === undefined && listed?.proposal.status === "pending") void discard(listed)
          return true
        case "e":
          if (busy === undefined && listed?.proposal.status === "rejected") void redo(listed)
          return true
        default:
          return false
      }
    },
    { layer: Layer.view, active: !filter.editing }
  )

  const wide = size.width >= 118
  const listWidth = wide ? Math.min(90, Math.max(56, Math.floor(size.width * 0.5))) : size.width
  const listHeight = wide ? size.height - 6 : Math.max(6, Math.floor((size.height - 6) * 0.4))
  const columns: ReadonlyArray<Column<Listed>> = [
    { header: "#", width: 5, align: "right", cell: (row) => String(row.proposal.id) },
    { header: "", width: 2, cell: (row) => row.proposal.language },
    ...(chosen.status === "all"
      ? [
          {
            header: "Status",
            width: 9,
            cell: (row: Listed) => row.proposal.status,
            fg: (row: Listed) => statusColor[row.proposal.status]
          }
        ]
      : []),
    { header: "Asks", width: 4, align: "right", cell: (row) => String(row.asks) },
    { header: "Age", width: 4, align: "right", cell: (row) => ago(row.proposal.createdAt, now) },
    {
      header: "Query",
      width: "fill",
      cell: (row) => `${row.proposal.contested ? "! " : ""}${headline(row.proposal)}`,
      fg: (row) => (row.proposal.contested ? color.accent : undefined)
    },
    { header: "By", width: 16, cell: (row) => drafterOf.get(row.proposal.id) ?? "", drop: 1 }
  ]

  const tabs = TABS.map((each) => ({
    label: each.label,
    count: counts.result.state === "ready" ? counts.result.value[each.count] : undefined
  }))

  const pending = listed?.proposal.status === "pending"
  const hints = [
    ...(pending
      ? [
          { key: "a", label: "approve…" },
          { key: "d", label: "discard…" }
        ]
      : []),
    ...(listed?.proposal.status === "rejected" ? [{ key: "e", label: "ask again…" }] : []),
    { key: "v", label: raw ? "formatted" : "as stored" },
    { key: "J/K", label: "scroll" },
    { key: "←→", label: "filter" },
    { key: "/", label: "search" },
    { key: "r", label: "refresh" }
  ]

  const listPanel = (
    <Panel
      title={`${chosen.label} ${symbol.dot} newest first`}
      grow={false}
      width={wide ? listWidth : undefined}
      height={wide ? undefined : listHeight + 2}
    >
      {list.result.state === "loading" ? (
        <Status state="loading">Reading proposals…</Status>
      ) : list.result.state === "error" ? (
        <Status state="error">{list.result.message}</Status>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          selected={at}
          height={listHeight}
          width={listWidth - 4}
          rowKey={(row) => String(row.proposal.id)}
          onSelect={(next) => {
            setIndex(next)
            scroll.current?.scrollTo(0)
          }}
          empty={
            filter.text.length > 0
              ? `Nothing matches "${filter.text}".`
              : tab === 0
                ? "Nothing waiting."
                : "Nothing there."
          }
        />
      )}
    </Panel>
  )

  const detailPanel = (
    <Panel title={listed === undefined ? "Proposal" : `Proposal #${listed.proposal.id}`}>
      {listed === undefined ? (
        <text fg={color.muted}>Pick a proposal to see it in full.</text>
      ) : (
        <ProposalDetail listed={listed} detail={detail.result} labels={labels} raw={raw} scroll={scroll} />
      )}
    </Panel>
  )

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Tabs tabs={tabs} selected={tab} width={size.width - (filter.editing || filter.text.length > 0 ? 36 : 0)} />
        <Filter filter={filter} />
      </box>
      <box flexDirection={wide ? "row" : "column"} flexGrow={1} flexShrink={1} minHeight={0} gap={1}>
        {listPanel}
        {detailPanel}
      </box>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Hints hints={hints} width={size.width - (busy === undefined ? 0 : 18)} />
        {busy === undefined ? null : (
          <text fg={color.muted}>
            <Spinner /> {busy}
            {symbol.ellipsis}
          </text>
        )}
      </box>
    </box>
  )
}
