import { Effect } from "effect"
import { coverage, type Coverage, type DictionaryCoverage, ENRICHMENTS } from "../../cli/status.ts"
import { Database } from "../../db/Database.ts"
import { type Account, Approvals } from "../../features/accounts/Approvals.ts"
import { listProposals, type Proposal } from "../../features/asks/review.ts"
import { ago, fit, number, percent, plural } from "../model/format.ts"
import { Hints, Meter, Panel, Row, Scroll, Spinner, Status, useNow } from "../ui/components.tsx"
import { useConsole, useViewSize } from "../ui/context.tsx"
import { Layer, useKeys } from "../ui/keys.tsx"
import { TargetLine } from "../ui/overlay.tsx"
import { useQuery } from "../ui/query.ts"
import { color, symbol } from "../ui/theme.ts"

const PROVIDERS: Readonly<Record<string, string>> = { nuance: "Jev", examples: "Claude", audio: "ElevenLabs" }
const JOB_STATUSES = ["queued", "running", "done", "failed"] as const

/** One dictionary's common entries, and how far each enrichment has reached them. */
const Dictionary = ({ dictionary, cells }: { readonly dictionary: DictionaryCoverage; readonly cells: number }) => (
  <box flexDirection="column">
    <text
      fg={color.muted}
    >{`${number(dictionary.entries)} entries ${symbol.dot} ${number(dictionary.common)} common`}</text>
    {ENRICHMENTS.map((kind) => (
      <text key={kind}>
        <span fg={color.muted}>{fit(kind, 10)}</span>
        <Meter part={dictionary.enriched[kind]} whole={dictionary.common} cells={cells} />
        <span fg={color.text}>{` ${fit(number(dictionary.enriched[kind]), 7, "right")}`}</span>
        <span fg={color.faint}>{fit(` / ${number(dictionary.common)}`, 9)}</span>
        <span fg={color.muted}>{fit(percent(dictionary.enriched[kind], dictionary.common), 4, "right")}</span>
      </text>
    ))}
  </box>
)

const Queue = ({ jobs }: { readonly jobs: Coverage["jobs"] }) => {
  const kinds = [...new Set(jobs.map((job) => job.kind))]
  if (kinds.length === 0) return <text fg={color.muted}>The job queue is empty.</text>
  const n = (kind: string, status: string) => jobs.find((job) => job.kind === kind && job.status === status)?.n ?? 0
  return (
    <box flexDirection="column">
      {kinds.map((kind) => (
        <text key={kind}>
          <span fg={color.muted}>{fit(kind, 10)}</span>
          {JOB_STATUSES.map((status) => (
            <span
              key={status}
              fg={
                status === "failed" && n(kind, status) > 0
                  ? color.danger
                  : status === "running" && n(kind, status) > 0
                    ? color.info
                    : color.text
              }
            >
              {fit(`${status} ${number(n(kind, status))}`, 15)}
            </span>
          ))}
        </text>
      ))}
    </box>
  )
}

/** How many waiting items the overview previews of each kind. */
const PREVIEW = 5

/** The oldest sign-ups and newest drafts, so the overview says what needs doing. */
const Waiting = ({
  signUps,
  drafts,
  wide,
  width
}: {
  readonly signUps: ReturnType<typeof useQuery<ReadonlyArray<Account>>>["result"]
  readonly drafts: ReturnType<typeof useQuery<ReadonlyArray<{ proposal: Proposal; asks: number }>>>["result"]
  readonly wide: boolean
  readonly width: number
}) => {
  const now = useNow(30_000)
  const room = (wide ? Math.floor((width - 1) / 2) : width) - 4
  return (
    <box flexDirection={wide ? "row" : "column"} gap={1} flexShrink={0}>
      <Panel title="Sign-ups waiting  (s)" grow={wide}>
        {signUps.state === "loading" ? (
          <Status state="loading">Reading sign-ups…</Status>
        ) : signUps.state === "error" ? (
          <Status state="error">{signUps.message}</Status>
        ) : signUps.value.length === 0 ? (
          <text fg={color.muted}>Nobody is waiting. {symbol.check}</text>
        ) : (
          <>
            {signUps.value.slice(0, PREVIEW).map((account) => (
              <text key={account.id}>
                <span fg={color.text}>{fit(account.email, room - 18)}</span>
                <span fg={account.emailVerified ? color.faint : color.warn}>
                  {fit(account.emailVerified ? "" : "unverified", 11)}
                </span>
                <span fg={color.muted}>{fit(ago(account.createdAt, now), 7, "right")}</span>
              </text>
            ))}
            {signUps.value.length > PREVIEW ? (
              <text fg={color.faint}>{`and ${signUps.value.length - PREVIEW} more`}</text>
            ) : null}
          </>
        )}
      </Panel>
      <Panel title="Drafts to review  (p)" grow={wide}>
        {drafts.state === "loading" ? (
          <Status state="loading">Reading drafts…</Status>
        ) : drafts.state === "error" ? (
          <Status state="error">{drafts.message}</Status>
        ) : drafts.value.length === 0 ? (
          <text fg={color.muted}>No drafts are waiting. {symbol.check}</text>
        ) : (
          drafts.value.slice(0, PREVIEW).map(({ proposal, asks }) => (
            <text key={proposal.id}>
              <span fg={color.faint}>{`${proposal.language}  `}</span>
              <span fg={color.text}>{fit(proposal.draft?.headword ?? proposal.query, room - 20)}</span>
              <span fg={color.muted}>{fit(`${asks} ${asks === 1 ? "ask" : "asks"}`, 9, "right")}</span>
              <span fg={color.muted}>{fit(ago(proposal.createdAt, now), 7, "right")}</span>
            </text>
          ))
        )}
      </Panel>
    </box>
  )
}

/** `kotori status`, as a dashboard: where the console points, coverage, the audio budget and the queue. */
export const Overview = () => {
  const { runtime, target, branch, waiting, navigate, refreshWaiting } = useConsole()
  const size = useViewSize()
  // Coverage reads every common entry, so a visit within five minutes reuses the last count; r recounts.
  const { result, reload } = useQuery("coverage", () => runtime.services.worker.run(coverage), 5 * 60_000)
  const signUps = useQuery(
    "overview-sign-ups",
    () =>
      runtime.services.accounts.run(
        Effect.gen(function* () {
          return yield* (yield* Approvals).requests()
        })
      ),
    30_000
  )
  const drafts = useQuery(
    "overview-drafts",
    () =>
      runtime.services.database.run(
        Effect.gen(function* () {
          return yield* listProposals(yield* Database, { status: "pending", limit: PREVIEW })
        })
      ),
    30_000
  )

  useKeys(
    (key) => {
      if (key.name === "r") {
        reload()
        signUps.reload()
        drafts.reload()
        refreshWaiting()
      } else if (key.name === "s") navigate("accounts")
      else if (key.name === "p") navigate("proposals")
      else return false
      return true
    },
    { layer: Layer.view }
  )

  const wide = size.width >= 110
  // Room for a meter: the panel's width less its border, padding, label and figures.
  const cells = Math.max(6, Math.min(36, (wide ? Math.floor((size.width - 1) / 2) : size.width) - 36))
  const providers = result.state === "ready" ? result.value.providers : undefined
  const named = size.width >= 100

  return (
    <box flexDirection="column" flexGrow={1}>
      <Scroll>
        <box flexDirection="column" gap={1}>
          <Panel title="Environment" grow={false}>
            <Row label="Database">
              <box flexDirection="row" gap={2}>
                <TargetLine target={target} />
                {branch === undefined || target.local ? null : <text fg={color.muted}>{`branch ${branch}`}</text>}
              </box>
            </Row>
            <Row label="Providers">
              {providers === undefined ? (
                <text fg={color.faint}>{result.state === "error" ? "unknown" : "checking…"}</text>
              ) : (
                <text>
                  {ENRICHMENTS.map((kind) => (
                    <span key={kind} fg={providers.includes(kind) ? color.ok : color.faint}>
                      {`${providers.includes(kind) ? symbol.check : symbol.cross} ${kind}${named ? ` (${PROVIDERS[kind]})` : ""}   `}
                    </span>
                  ))}
                </text>
              )}
            </Row>
            <Row label="Waiting">
              <text>
                <span fg={(waiting.signUps ?? 0) > 0 ? color.warn : color.muted}>
                  {waiting.signUps === undefined ? "sign-ups …" : plural(waiting.signUps, "sign-up")}
                </span>
                <span fg={color.faint}>{`  ${symbol.dot}  `}</span>
                <span fg={(waiting.proposals ?? 0) > 0 ? color.warn : color.muted}>
                  {waiting.proposals === undefined ? "drafts …" : `${plural(waiting.proposals, "draft")} to review`}
                </span>
              </text>
            </Row>
          </Panel>
          <Waiting signUps={signUps.result} drafts={drafts.result} wide={wide} width={size.width} />
          {result.state === "loading" ? (
            <Panel title="Coverage" grow={false}>
              <Status state="loading">Counting the dictionary… this reads every common entry.</Status>
            </Panel>
          ) : result.state === "error" ? (
            <Panel title="Coverage" grow={false}>
              <Status state="error">{result.message}</Status>
            </Panel>
          ) : (
            <box flexDirection={wide ? "row" : "column"} gap={1} flexShrink={0}>
              {result.value.dictionaries.map((dictionary) => (
                <Panel key={dictionary.language} title={`${dictionary.name}, common entries`} grow={wide}>
                  <Dictionary dictionary={dictionary} cells={cells} />
                </Panel>
              ))}
            </box>
          )}
          <Panel title="Audio budget and job queue" grow={false}>
            {result.state === "ready" ? (
              <>
                <text>
                  <span fg={color.muted}>{fit("30 days", 10)}</span>
                  <Meter
                    part={result.value.audio.used}
                    whole={result.value.audio.budget}
                    cells={cells}
                    fg={result.value.audio.used > result.value.audio.budget * 0.9 ? color.warn : color.sky}
                  />
                  <span fg={color.text}>{` ${number(result.value.audio.used)}`}</span>
                  <span fg={color.faint}>{` / ${number(result.value.audio.budget)} characters`}</span>
                </text>
                <Queue jobs={result.value.jobs} />
              </>
            ) : (
              <text fg={color.faint}>…</text>
            )}
          </Panel>
        </box>
      </Scroll>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Hints
          hints={[
            { key: "r", label: "refresh" },
            { key: "s", label: "sign-ups" },
            { key: "p", label: "proposals" }
          ]}
          width={size.width - 14}
        />
        {result.state !== "loading" && result.refreshing ? (
          <text fg={color.muted}>
            <Spinner /> refreshing
          </text>
        ) : null}
      </box>
    </box>
  )
}
