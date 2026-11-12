import type { LabelSeverity } from "@kotori/contracts"
import { useState } from "react"
import { Platform, Pressable, View } from "react-native"
import type { ChipItem } from "../lib/entry.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Chip } from "./Chip.tsx"
import { Icon } from "./Icon.tsx"
import { Text } from "./Text.tsx"

/** A chip's colours by how loudly it should speak: `quiet` outlined, `info` green, `warning` amber, `avoid` rose. */
const useSeverityColors = (severity: LabelSeverity, onTint: boolean) => {
  const { color } = useTheme()
  return (
    {
      quiet: { fg: color.textMuted, bg: "transparent", ring: color.border },
      // On the hero's tint a green chip would vanish, so it sits on white there.
      info: onTint
        ? { fg: color.primaryDeep, bg: color.surface, ring: color.surface }
        : { fg: color.primaryDeep, bg: color.primaryTint, ring: color.primaryTint },
      warning: { fg: color.caution, bg: color.cautionSoft, ring: color.cautionSoft },
      avoid: { fg: color.accent, bg: color.accentSoft, ring: color.accentSoft }
    } satisfies Record<LabelSeverity, { fg: string; bg: string; ring: string }>
  )[severity]
}

/**
 * A label chip that doesn't explain itself, for a place that is a link as a whole, such as a
 * search result: coloured by severity, Kotori's carrying the ✦ mark.
 */
export const LabelTag = ({ item }: { readonly item: ChipItem }) => {
  const colors = useSeverityColors(item.severity, false)
  return (
    <View
      style={{
        minHeight: 26,
        paddingVertical: 4,
        paddingHorizontal: 10,
        justifyContent: "center",
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.ring,
        borderRadius: 13,
        alignSelf: "flex-start"
      }}
    >
      <Text variant="caption" style={{ color: colors.fg, lineHeight: 16 }}>
        {item.kotori ? `${item.label} ✦` : item.label}
      </Text>
    </View>
  )
}

/**
 * A chip coloured by how loudly it should speak (`useSeverityColors`). Kotori's carry the ✦ mark.
 * Pressing it (or hovering, on the web) opens its explanation under the row.
 */
const SeverityChip = ({
  item,
  onTint,
  open,
  onToggle,
  onHover
}: {
  readonly item: ChipItem
  readonly onTint: boolean
  readonly open: boolean
  readonly onToggle: () => void
  readonly onHover: () => void
}) => {
  const colors = useSeverityColors(item.severity, onTint)
  return (
    <Pressable
      onPress={onToggle}
      onHoverIn={Platform.OS === "web" ? onHover : undefined}
      accessibilityRole="button"
      accessibilityLabel={item.kotori ? `${item.label} ✦` : item.label}
      accessibilityHint={item.help}
      accessibilityState={{ expanded: open }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        minHeight: 26,
        paddingVertical: 4,
        paddingHorizontal: item.icon ? 9 : 10,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: open ? colors.fg : colors.ring,
        borderRadius: 13,
        alignSelf: "flex-start"
      }}
    >
      {item.icon ? <Icon name={item.icon} size={15} color={colors.fg} /> : null}
      <Text variant="caption" style={{ color: colors.fg, lineHeight: 16, flexShrink: 1 }}>
        {item.kotori ? `${item.label} ✦` : item.label}
      </Text>
    </Pressable>
  )
}

const NO_PLAIN: ReadonlyArray<string> = []

/**
 * A row of chips that explain themselves, one at a time, in a line under the row. Plain chips
 * (parts of speech, subject fields) lead in the neutral outline and explain nothing.
 */
export const ChipRow = ({
  items,
  plain = NO_PLAIN,
  onTint = false
}: {
  readonly items: ReadonlyArray<ChipItem>
  readonly plain?: ReadonlyArray<string>
  /** On the hero's green tint rather than a white card. */
  readonly onTint?: boolean
}) => {
  const theme = useTheme()
  const [open, setOpen] = useState<string | null>(null)
  if (items.length + plain.length === 0) return null
  const shown = items.find((item) => item.key === open)
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {plain.map((label) => (
          <Chip key={label} label={label} />
        ))}
        {items.map((item) => (
          <SeverityChip
            key={item.key}
            item={item}
            onTint={onTint}
            open={open === item.key}
            onToggle={() => setOpen(open === item.key ? null : item.key)}
            onHover={() => setOpen(item.key)}
          />
        ))}
      </View>
      {shown ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", paddingLeft: 2 }}
        >
          <View style={{ paddingTop: 1 }}>
            <Icon name="info" size={14} color={theme.color.textFaint} />
          </View>
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {shown.help}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
