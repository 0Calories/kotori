import { TextAttributes } from "@opentui/core"
import type { DraftEntry, EntryRecord } from "@kotori/contracts"
import { relative } from "node:path"
import type { ApprovalPlan } from "../../features/asks/review.ts"
import { workspaceRoot } from "../../runtime/Paths.ts"
import { Row } from "../ui/components.tsx"
import { color, symbol } from "../ui/theme.ts"

/** Tag codes as the dictionary labels them, falling back to the code itself. */
export type TagLabels = ReadonlyMap<string, string>

const label = (labels: TagLabels, code: string) => labels.get(code) ?? code

/** Glosses are in the asker's language: Japanese ones run together with 、, English ones with ;. */
const glossSeparator = (language: "en" | "ja") => (language === "ja" ? "; " : "、")

const LANGUAGE = { ja: "Japanese", en: "English" } as const

/** A numbered sense, its tags and note hanging under the glosses when they wrap. */
const Sense = ({
  number,
  glosses,
  tags,
  note,
  first = false
}: {
  readonly number: number
  readonly glosses: string
  readonly tags: ReadonlyArray<string>
  readonly note?: string | null
  readonly first?: boolean
}) => (
  <box flexDirection="row" flexShrink={0} marginTop={first ? 1 : 0}>
    <box width={4} flexShrink={0}>
      <text fg={color.primary} attributes={TextAttributes.BOLD}>
        {String(number).padStart(2)}
      </text>
    </box>
    <box flexDirection="column" flexGrow={1} flexShrink={1}>
      <text fg={color.text}>{glosses}</text>
      {tags.length === 0 ? null : <text fg={color.sky}>{tags.join(` ${symbol.dot} `)}</text>}
      {note === undefined || note === null ? null : <text fg={color.muted}>{note}</text>}
    </box>
  </box>
)

/** The draft as the learners who asked see it in the app now: an unchecked AI draft. */
export const DraftCard = ({
  draft,
  language,
  labels
}: {
  readonly draft: DraftEntry
  readonly language: "en" | "ja"
  readonly labels: TagLabels
}) => {
  const reading = draft.reading.length > 0 && draft.reading !== draft.headword ? draft.reading : undefined
  const spellings = draft.spellings.filter((text) => text !== draft.headword)
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={color.primarySoft}
      paddingLeft={1}
      paddingRight={1}
      title={` ${symbol.sparkle} AI draft, unchecked `}
      titleColor={color.accent}
    >
      <text>
        <span fg={color.text} attributes={TextAttributes.BOLD}>
          {draft.headword}
        </span>
        {reading === undefined ? null : <span fg={color.muted}>{`  ${reading}`}</span>}
        {draft.currency === "current" ? null : <span fg={color.warn}>{`   ${draft.currency}`}</span>}
      </text>
      {spellings.length === 0 ? null : <text fg={color.muted}>{`also written ${spellings.join(", ")}`}</text>}
      {draft.senses
        .map((sense, index) => ({ sense, number: index + 1 }))
        .map(({ sense, number }) => (
          <Sense
            key={number}
            number={number}
            first={number === 1}
            glosses={sense.glosses.join(glossSeparator(language))}
            tags={[
              ...(sense.partOfSpeech === null ? [] : [label(labels, sense.partOfSpeech)]),
              ...sense.labels.map((code) => label(labels, code))
            ]}
            note={sense.note}
          />
        ))}
    </box>
  )
}

const formsLine = (record: EntryRecord, added?: string) =>
  record.forms
    .map((form) => `${form.text} ${form.kind}${form.text === added ? " (new)" : ""}`)
    .join(`  ${symbol.dot}  `)

/** The senses as the dictionary stores them, with their tags spelled out. */
const Senses = ({
  record,
  labels,
  limit = Infinity
}: {
  readonly record: EntryRecord
  readonly labels: TagLabels
  readonly limit?: number
}) => (
  <box flexDirection="column">
    {record.senses
      .slice(0, limit)
      .map((sense, index) => ({ sense, number: index + 1 }))
      .map(({ sense, number }) => (
        <Sense
          key={number}
          number={number}
          glosses={sense.glosses.map((gloss) => gloss.text).join(glossSeparator(record.language))}
          tags={[...sense.pos, ...sense.misc].map((code) => label(labels, code))}
        />
      ))}
    {record.senses.length > limit ? (
      <text fg={color.faint}>{`    and ${record.senses.length - limit} more senses`}</text>
    ) : null}
  </box>
)

const shownPath = (file: string) => relative(workspaceRoot, file) || file

/**
 * What approving does, from the same plan `approveProposal` applies: the entry it inserts (or the
 * form it adds), the notes and jobs that follow, the file to commit, and what the askers then see.
 */
export const ApprovalPreview = ({
  plan,
  labels,
  askers
}: {
  readonly plan: ApprovalPlan
  readonly labels: TagLabels
  /** How many learners asked, who see the result. */
  readonly askers: number | undefined
}) => {
  const learners =
    askers === undefined
      ? "everyone who asked sees it"
      : askers === 1
        ? "the learner who asked sees it"
        : `the ${askers} learners who asked see it`
  if (plan.kind === "alias") {
    const after: EntryRecord =
      plan.form === undefined ? plan.base : { ...plan.base, forms: [...plan.base.forms, plan.form] }
    return (
      <box flexDirection="column" gap={1}>
        <text>
          <span fg={color.text}>{`"${plan.alias}" becomes a way to write `}</span>
          <span fg={color.text} attributes={TextAttributes.BOLD}>
            {plan.base.headword}
          </span>
          <span
            fg={color.muted}
          >{`  #${plan.base.id}, an entry the ${LANGUAGE[plan.base.language]} dictionary has`}</span>
        </text>
        <box flexDirection="column">
          <Row label="Forms">
            <text fg={color.text}>{formsLine(after, plan.form?.text)}</text>
          </Row>
          {plan.form !== undefined ? null : (
            <Row label="">
              <text fg={color.faint}>
                It's already one of the entry's forms, so only the file and the proposal change.
              </text>
            </Row>
          )}
          <Row label="Senses">
            <Senses record={plan.base} labels={labels} limit={3} />
          </Row>
        </box>
        <box flexDirection="column">
          <Row label="Saves">
            <text fg={color.text}>{`a line in ${shownPath(plan.file)}, which every reseed replays: commit it`}</text>
          </Row>
          <Row label="Learners">
            <text fg={color.text}>{`${learners} as #${plan.base.id} ${plan.base.headword}, not a draft`}</text>
          </Row>
        </box>
      </box>
    )
  }
  const { record } = plan
  return (
    <box flexDirection="column" gap={1}>
      <text>
        <span fg={color.text}>New entry </span>
        <span fg={color.text} attributes={TextAttributes.BOLD}>{`#${record.id}`}</span>
        <span fg={color.muted}>{` in the ${LANGUAGE[record.language]} dictionary, not marked common`}</span>
      </text>
      <box flexDirection="column">
        <text>
          <span fg={color.text} attributes={TextAttributes.BOLD}>
            {record.headword}
          </span>
          {record.reading.length > 0 && record.reading !== record.headword ? (
            <span fg={color.muted}>{`  ${record.reading}`}</span>
          ) : null}
        </text>
        <Row label="Forms">
          <text fg={color.text}>{formsLine(record)}</text>
        </Row>
      </box>
      <Senses record={record} labels={labels} />
      <box flexDirection="column">
        <Row label="Notes">
          <text fg={color.text}>
            {plan.notes.length === 0
              ? "none"
              : `${plan.notes.length} usage ${plan.notes.length === 1 ? "note" : "notes"}, kept with the entry's sense notes`}
          </text>
        </Row>
        <Row label="Queues">
          <text fg={color.text}>{`${plan.jobs.join(", ")}, ahead of the backfill`}</text>
        </Row>
        <Row label="Saves">
          <text fg={color.text}>{`a line in ${shownPath(plan.file)}, which every reseed replays: commit it`}</text>
        </Row>
        <Row label="Learners">
          <text fg={color.text}>{`${learners} as a regular entry, not a draft`}</text>
        </Row>
      </box>
      <text fg={color.faint}>The id is the next free one now; another approval first would take it.</text>
    </box>
  )
}
