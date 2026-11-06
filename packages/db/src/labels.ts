import { foreignKey, integer, primaryKey, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/**
 * How loudly a label is shown: `avoid` (don't say it), `caution` (only in the right company),
 * `info` (worth knowing), `quiet` (a grammar or spelling fact, explained on tap).
 */
export const LabelSeverity = Schema.Literals(["avoid", "caution", "info", "quiet"])
export type LabelSeverity = typeof LabelSeverity.Type

/**
 * One vocabulary for usage labels, each with its severity: JMDict's `misc` codes, which the
 * English dictionary also uses, the English dictionary's regions and countability, and Kotori's
 * `form` fill for formal written words the dictionary leaves untagged.
 */
export const LABEL_SEVERITY = {
  vulg: "avoid",
  X: "avoid",
  derog: "avoid",
  arch: "avoid",
  obs: "avoid",
  col: "caution",
  sl: "caution",
  "net-sl": "caution",
  fam: "caution",
  joc: "caution",
  euph: "caution",
  male: "caution",
  fem: "caution",
  chn: "caution",
  dated: "caution",
  hist: "caution",
  rare: "caution",
  hon: "info",
  hum: "info",
  pol: "info",
  form: "info",
  poet: "info",
  ksb: "info",
  "en-US": "info",
  "en-GB": "info",
  "en-AU": "info",
  id: "quiet",
  "on-mim": "quiet",
  abbr: "quiet",
  wasei: "quiet",
  uncountable: "quiet"
} as const satisfies Record<string, LabelSeverity>

export const LabelCode = Schema.Literals(
  Object.keys(LABEL_SEVERITY) as [keyof typeof LABEL_SEVERITY, ...Array<keyof typeof LABEL_SEVERITY>]
)
export type LabelCode = typeof LabelCode.Type

export const labelSeverity = (code: LabelCode): LabelSeverity => LABEL_SEVERITY[code]

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
