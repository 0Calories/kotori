import { TextAttributes } from "@opentui/core"
import { Effect, Exit } from "effect"
import { useState } from "react"
import { type Account, Approvals } from "../../features/accounts/Approvals.ts"
import { Mailer } from "../../integrations/email/Mailer.ts"
import { describeCause } from "../model/describe.ts"
import { ago, truncate } from "../model/format.ts"
import { type Column, Hints, Panel, Spinner, Status, Table, Tabs, useNow } from "../ui/components.tsx"
import { useConsole, useViewSize } from "../ui/context.tsx"
import { Filter, useFilter } from "../ui/filter.tsx"
import { Layer, moveIn, useKeys } from "../ui/keys.tsx"
import { useOverlay } from "../ui/overlay.tsx"
import { invalidate, useQuery } from "../ui/query.ts"
import { color, symbol } from "../ui/theme.ts"

const TABS = [
  { label: "Waiting", keep: (account: Account) => account.status === "pending", newestFirst: false },
  { label: "Archived", keep: (account: Account) => account.status === "archived", newestFirst: false },
  { label: "Approved", keep: (account: Account) => account.status === "approved", newestFirst: true },
  { label: "Admins", keep: (account: Account) => account.role === "admin", newestFirst: true },
  { label: "All", keep: () => true, newestFirst: true }
] as const

const statusColor = (status: string) =>
  status === "pending" ? color.warn : status === "archived" ? color.faint : color.ok

const useAccounts = () => {
  const { runtime } = useConsole()
  return useQuery("accounts", () =>
    runtime.services.accounts.run(
      Effect.gen(function* () {
        const approvals = yield* Approvals
        return yield* approvals.users()
      })
    )
  )
}

/** Sign-ups and accounts: `kotori requests`, `users`, `approve`, `archive`, `admin` and `revoke`. */
export const Accounts = () => {
  const { runtime, refreshWaiting } = useConsole()
  const overlay = useOverlay()
  const size = useViewSize()
  const { result, reload } = useAccounts()
  // Without RESEND_API_KEY the mailer only logs, so approving says so rather than claiming an email.
  const mailer = useQuery(
    "mailer",
    () =>
      runtime.services.accounts.run(
        Effect.gen(function* () {
          return (yield* Mailer).configured
        })
      ),
    Infinity
  )
  const emails = mailer.result.state !== "ready" || mailer.result.value
  const [tab, setTab] = useState(0)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const filter = useFilter()

  const now = useNow(30_000)
  const all = result.state === "ready" ? result.value : []
  const counts = TABS.map((each) => all.filter(each.keep).length)
  const chosen = TABS[tab]!
  const rows = all
    .filter(chosen.keep)
    .filter((account) => filter.matches(`${account.email} ${account.name}`))
    .toSorted((a, b) => (chosen.newestFirst ? -1 : 1) * (a.createdAt.getTime() - b.createdAt.getTime()))
  const at = Math.min(index, Math.max(0, rows.length - 1))
  const account = rows[at]

  /** Runs an approval action, then says what happened in the CLI's words and reloads. */
  const act = async (
    label: string,
    confirm: Parameters<typeof overlay.confirm>[0],
    run: (approvals: Approvals["Service"]) => Effect.Effect<Account, { readonly _tag: "NoSuchUser" }>,
    done: (account: Account) => string
  ) => {
    if (account === undefined || busy !== undefined) return
    if (!(await overlay.confirm(confirm))) return
    setBusy(label)
    const exit = await runtime.services.accounts.run(
      Effect.gen(function* () {
        return yield* run(yield* Approvals)
      })
    )
    setBusy(undefined)
    invalidate("overview-sign-ups")
    if (Exit.isSuccess(exit)) overlay.toast("ok", done(exit.value))
    else
      overlay.toast(
        "error",
        describeCause(exit.cause).replace(/^NoSuchUser$/u, `No account with the email ${account.email}.`)
      )
    reload()
    refreshWaiting()
  }

  useKeys(
    (key) => {
      const moved = moveIn(key, at, rows.length, size.height - 12)
      if (moved !== undefined) {
        setIndex(moved)
        return true
      }
      switch (key.name) {
        case "left":
        case "h":
          setTab((value) => (value + TABS.length - 1) % TABS.length)
          setIndex(0)
          return true
        case "right":
        case "l":
          setTab((value) => (value + 1) % TABS.length)
          setIndex(0)
          return true
        case "/":
          filter.open()
          return true
        case "escape":
          if (filter.text.length === 0) return false
          filter.clear()
          return true
        case "r":
          reload()
          refreshWaiting()
          return true
        case "a":
          if (account === undefined || account.status === "approved") return true
          void act(
            "Approving",
            {
              title: "Approve sign-up",
              lines: [
                `Approve ${account.email}?`,
                emails
                  ? "Kotori emails them that they can start using the app."
                  : "RESEND_API_KEY isn't set, so the welcome email only goes to the log."
              ],
              action: "Approve",
              writes: true
            },
            (approvals) => approvals.approve(account.email),
            (approved) =>
              emails
                ? `Approved ${approved.email}; they've been emailed.`
                : `Approved ${approved.email}. No email went out: RESEND_API_KEY isn't set.`
          )
          return true
        case "x":
          if (account?.status !== "pending") return true
          void act(
            "Archiving",
            {
              title: "Archive sign-up",
              lines: [
                `Archive ${account.email}?`,
                "Nothing is sent, and to them it still looks pending. Approve them later from Archived."
              ],
              action: "Archive",
              writes: true
            },
            (approvals) => approvals.archive(account.email),
            (archived) => `Archived ${archived.email}. Nothing was sent.`
          )
          return true
        case "m": {
          if (account === undefined) return true
          const promote = account.role !== "admin"
          void act(
            promote ? "Promoting" : "Demoting",
            {
              title: promote ? "Make admin" : "Remove admin",
              lines: promote
                ? [`Make ${account.email} an admin?`, "Admins skip approval."]
                : [`Make ${account.email} a regular learner again?`],
              action: promote ? "Make admin" : "Remove admin",
              writes: true
            },
            (approvals) => approvals.setRole(account.email, promote ? "admin" : "user"),
            (changed) => `${changed.email} is now ${promote ? "an admin" : "a learner"}.`
          )
          return true
        }
        case "o":
          if (account === undefined) return true
          void act(
            "Signing out",
            {
              title: "Sign out everywhere",
              lines: [`Sign ${account.email} out of every device?`, "They'll have to sign in again."],
              action: "Sign out",
              writes: true,
              danger: true
            },
            (approvals) => approvals.revoke(account.email),
            (revoked) => `Signed ${revoked.email} out everywhere.`
          )
          return true
        default:
          return false
      }
    },
    { layer: Layer.view, active: !filter.editing }
  )

  const columns: ReadonlyArray<Column<Account>> = [
    { header: "Email", width: "fill", cell: (row) => row.email },
    { header: "Name", width: 18, cell: (row) => row.name.trim() || "—", drop: 2 },
    { header: "Status", width: 8, cell: (row) => row.status, fg: (row) => statusColor(row.status) },
    {
      header: "Verified",
      width: 8,
      cell: (row) => (row.emailVerified ? symbol.check : "not yet"),
      fg: (row) => (row.emailVerified ? color.muted : color.warn),
      drop: 3
    },
    {
      header: "Role",
      width: 5,
      cell: (row) => row.role,
      fg: (row) => (row.role === "admin" ? color.sky : undefined),
      drop: 1
    },
    { header: "Joined", width: 10, align: "right", cell: (row) => ago(row.createdAt, now) }
  ]

  const hints = [
    ...(account !== undefined && account.status !== "approved" ? [{ key: "a", label: "approve" }] : []),
    ...(account?.status === "pending" ? [{ key: "x", label: "archive" }] : []),
    ...(account === undefined ? [] : [{ key: "m", label: account.role === "admin" ? "remove admin" : "make admin" }]),
    ...(account === undefined ? [] : [{ key: "o", label: "sign out everywhere" }]),
    { key: "←→", label: "filter" },
    { key: "/", label: "search" },
    { key: "r", label: "refresh" }
  ]

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Tabs
          tabs={TABS.map((each, n) => ({ label: each.label, count: counts[n] }))}
          selected={tab}
          width={size.width - (filter.editing || filter.text.length > 0 ? 36 : 0)}
        />
        <Filter filter={filter} />
      </box>
      <Panel padded>
        {result.state === "loading" ? (
          <Status state="loading">Reading accounts…</Status>
        ) : result.state === "error" ? (
          <Status state="error">{result.message}</Status>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            selected={at}
            height={Math.max(4, size.height - 11)}
            width={size.width - 4}
            rowKey={(row) => row.id}
            onSelect={setIndex}
            empty={
              filter.text.length > 0
                ? `No account matches "${filter.text}".`
                : tab === 0
                  ? "Nobody is waiting for approval."
                  : "No accounts here."
            }
          />
        )}
      </Panel>
      <box flexDirection="column" height={2} flexShrink={0}>
        {account === undefined ? null : (
          <>
            <text>
              <span fg={color.text} attributes={TextAttributes.BOLD}>
                {truncate(account.email, size.width - 30)}
              </span>
              <span fg={statusColor(account.status)}>{`  ${account.status}`}</span>
              <span
                fg={color.muted}
              >{`  ${symbol.dot}  ${account.role}  ${symbol.dot}  ${account.emailVerified ? "verified" : "unverified"}`}</span>
            </text>
            <text fg={color.faint}>
              {truncate(
                `${account.name.trim() || "no name"}  ${symbol.dot}  joined ${account.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC  ${symbol.dot}  ${account.id}`,
                size.width
              )}
            </text>
          </>
        )}
      </box>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Hints hints={hints} width={size.width - (busy === undefined ? 0 : 16)} />
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
