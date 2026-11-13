import type { LabelSeverity } from "@kotori/contracts"
import { View } from "react-native"
import type { ChipItem } from "../lib/entry.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Chip, type ChipColors, ChipFace, chipRing, useChipPalette } from "./Chip.tsx"
import { TooltipTrigger } from "./Tooltip.tsx"

/** What Kotori's AI added rather than a dictionary carries this after its name. */
const KOTORI_MARK = "✦"

/**
 * A chip's colours by how loudly it should speak: `quiet` an ink wash, `info` the theme's colour,
 * `warning` amber, `avoid` rose.
 */
const useSeverityColors = (severity: LabelSeverity, onTint: boolean): ChipColors => {
  const { color } = useTheme()
  const tone = useChipPalette()
  return (
    {
      quiet: { ...tone.neutral, dot: color.textFaint },
      // On the hero's tint a chip of the theme's colour would vanish, so it sits on white there.
      info: { ...tone.primary, bg: onTint ? color.surface : tone.primary.bg, dot: color.primaryPressed },
      warning: { fg: color.caution, bg: color.cautionSoft, ring: chipRing(color.caution), dot: color.cautionMark },
      avoid: tone.accent
    } satisfies Record<LabelSeverity, ChipColors>
  )[severity]
}

/** The chip's name, with Kotori's mark after it if Kotori's AI added it. */
const markedLabel = (item: ChipItem) => (item.kotori ? `${item.label} ${KOTORI_MARK}` : item.label)

/**
 * A label chip that doesn't explain itself, for a place that is a link as a whole, such as a
 * search result: coloured by severity, Kotori's carrying the ✦ mark.
 */
export const LabelTag = ({ item }: { readonly item: ChipItem }) => (
  <ChipFace label={markedLabel(item)} colors={useSeverityColors(item.severity, false)} />
)

/**
 * A chip coloured by how loudly it should speak (`useSeverityColors`), led by a dot (or its icon)
 * that says it has more to tell: its explanation opens in a tooltip. Kotori's carry the ✦ mark,
 * and a fainter note under the explanation says the dictionary doesn't.
 */
const SeverityChip = ({ item, onTint }: { readonly item: ChipItem; readonly onTint: boolean }) => {
  const { t } = useSession()
  const colors = useSeverityColors(item.severity, onTint)
  const label = markedLabel(item)
  return (
    <TooltipTrigger text={item.help} note={item.kotori ? `${KOTORI_MARK} ${t.labels.kotori}` : undefined} label={label}>
      {(open) => <ChipFace label={label} colors={colors} icon={item.icon} dot lit={open} />}
    </TooltipTrigger>
  )
}

const NO_PLAIN: ReadonlyArray<string> = []

/**
 * A row of chips that explain themselves in a tooltip. Plain chips (parts of speech, subject
 * fields) lead in the neutral wash and explain nothing.
 */
export const ChipRow = ({
  items,
  plain = NO_PLAIN,
  onTint = false
}: {
  readonly items: ReadonlyArray<ChipItem>
  readonly plain?: ReadonlyArray<string>
  /** On the hero's tint rather than a white card. */
  readonly onTint?: boolean
}) =>
  items.length + plain.length === 0 ? null : (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {plain.map((label) => (
        <Chip key={label} label={label} />
      ))}
      {items.map((item) => (
        <SeverityChip key={item.key} item={item} onTint={onTint} />
      ))}
    </View>
  )
