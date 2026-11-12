import type { LabelSeverity } from "@kotori/contracts"
import { View } from "react-native"
import type { ChipItem } from "../lib/entry.ts"
import { SnowPebbleRow, VariantLabelTag } from "../proto/ChipVariants.tsx"
import { useChipVariant } from "../proto/chipVariant.tsx"
import { type GrammarTagItem, plainToGrammarTags } from "../proto/grammar.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { Chip, type ChipColors, ChipFace } from "./Chip.tsx"
import { TooltipTrigger } from "./Tooltip.tsx"

/**
 * A chip's colours by how loudly it should speak: `quiet` an ink wash, `info` the theme's colour,
 * `warning` amber, `avoid` rose.
 */
const useSeverityColors = (severity: LabelSeverity, onTint: boolean): ChipColors => {
  const { color } = useTheme()
  const ring = (fg: string) => fade(fg, 0.1)
  return (
    {
      quiet: { fg: color.textMuted, bg: fade(color.ink, 0.055), ring: "transparent", dot: color.textFaint },
      // On the hero's tint a chip of the theme's colour would vanish, so it sits on white there.
      info: {
        fg: color.primaryDeep,
        bg: onTint ? color.surface : color.primaryTint,
        ring: ring(color.primaryDeep),
        dot: color.primaryPressed
      },
      warning: { fg: color.caution, bg: color.cautionSoft, ring: ring(color.caution), dot: color.cautionMark },
      avoid: { fg: color.accent, bg: color.accentSoft, ring: ring(color.accent) }
    } satisfies Record<LabelSeverity, ChipColors>
  )[severity]
}

const named = (item: ChipItem) => (item.kotori ? `${item.label} ✦` : item.label)

/**
 * A label chip that doesn't explain itself, for a place that is a link as a whole, such as a
 * search result: coloured by severity, Kotori's carrying the ✦ mark.
 */
export const LabelTag = ({ item }: { readonly item: ChipItem }) => {
  const variant = useChipVariant()
  const colors = useSeverityColors(item.severity, false)
  if (variant !== "OLD") return <VariantLabelTag item={item} />
  return <ChipFace label={named(item)} colors={colors} />
}

/**
 * A chip coloured by how loudly it should speak (`useSeverityColors`), led by a dot (or its icon)
 * that says it has more to tell: its explanation opens in a tooltip. Kotori's carry the ✦ mark.
 */
const SeverityChip = ({ item, onTint }: { readonly item: ChipItem; readonly onTint: boolean }) => {
  const colors = useSeverityColors(item.severity, onTint)
  return (
    <TooltipTrigger text={item.help} note={item.note} label={named(item)}>
      {(open) => <ChipFace label={named(item)} colors={colors} icon={item.icon} dot lit={open} />}
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
  grammar,
  onTint = false
}: {
  readonly items: ReadonlyArray<ChipItem>
  readonly plain?: ReadonlyArray<string>
  readonly grammar?: ReadonlyArray<GrammarTagItem>
  /** On the hero's tint rather than a white card. */
  readonly onTint?: boolean
}) => {
  const variant = useChipVariant()
  const resolvedGrammar = grammar ?? plainToGrammarTags(plain)
  if (items.length + resolvedGrammar.length === 0 && plain.length === 0) return null
  if (variant !== "OLD") {
    return <SnowPebbleRow items={items} grammar={resolvedGrammar} onTint={onTint} />
  }
  const oldPlain = plain.length > 0 ? plain : resolvedGrammar.map((item) => item.label)
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {oldPlain.map((label) => (
        <Chip key={label} label={label} />
      ))}
      {items.map((item) => (
        <SeverityChip key={item.key} item={item} onTint={onTint} />
      ))}
    </View>
  )
}
