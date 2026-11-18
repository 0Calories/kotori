import { foreignKey, integer, primaryKey, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/**
 * How loudly a label is shown: `avoid` (don't say it), `warning` (only in the right company),
 * `info` (worth knowing), `quiet` (a grammar or spelling fact, explained on tap).
 */
export const LabelSeverity = Schema.Literals(["avoid", "warning", "info", "quiet"])
export type LabelSeverity = typeof LabelSeverity.Type

/**
 * One vocabulary for usage labels, each with its severity: JMDict's `misc` codes, which the
 * English dictionary also uses, JMDict's dialects, the English dictionary's regions and
 * countability, and Kotori's `form` fill for formal written words the dictionary leaves untagged.
 * Codes outside it (name types such as `place`, spelling facts such as `uk`, and `countable`,
 * the prior) are not labels.
 */
export const LABEL_SEVERITY = {
  vulg: "avoid",
  X: "avoid",
  derog: "avoid",
  arch: "avoid",
  obs: "avoid",
  col: "warning",
  sl: "warning",
  "net-sl": "warning",
  fam: "warning",
  joc: "warning",
  euph: "warning",
  male: "warning",
  fem: "warning",
  chn: "warning",
  dated: "warning",
  hist: "warning",
  rare: "warning",
  "m-sl": "warning",
  sens: "warning",
  nonstd: "warning",
  hon: "info",
  hum: "info",
  pol: "info",
  form: "info",
  poet: "info",
  // JMDict's dialects
  ksb: "info",
  osb: "info",
  ktb: "info",
  kyb: "info",
  kyu: "info",
  hob: "info",
  thb: "info",
  tsb: "info",
  tsug: "info",
  rkb: "info",
  nab: "info",
  bra: "info",
  // The English dictionary's regions
  "en-US": "info",
  "en-GB": "info",
  "en-AU": "info",
  "en-CA": "info",
  "en-NZ": "info",
  "en-IE": "info",
  "en-scotland": "info",
  "en-IN": "info",
  "en-PH": "info",
  "en-SG": "info",
  "en-ZA": "info",
  id: "quiet",
  "on-mim": "quiet",
  abbr: "quiet",
  proverb: "quiet",
  yoji: "quiet",
  wasei: "quiet",
  uncountable: "quiet"
} as const satisfies Record<string, LabelSeverity>

export const LabelCode = Schema.Literals(
  Object.keys(LABEL_SEVERITY) as [keyof typeof LABEL_SEVERITY, ...Array<keyof typeof LABEL_SEVERITY>]
)
export type LabelCode = typeof LabelCode.Type

export const labelSeverity = (code: LabelCode): LabelSeverity => LABEL_SEVERITY[code]

export const isLabelCode = (code: string): code is LabelCode => Object.hasOwn(LABEL_SEVERITY, code)

/**
 * A sense's usage labels, one row per code. Only what differs from the learner's prior (neutral,
 * current, anyone says it) is stored; silence means unremarkable. One source per label: a
 * dictionary's code is never overwritten by Kotori's fill.
 */
export const labels = table(
  "labels",
  {
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    code: text().$type<LabelCode>().notNull(),
    source: source().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.sense, t.code] }),
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete("cascade")
  ]
)
