import { foreignKey, integer, primaryKey, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const LabelSeverity = Schema.Literals(["avoid", "warning", "info", "quiet"])
export type LabelSeverity = typeof LabelSeverity.Type

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
