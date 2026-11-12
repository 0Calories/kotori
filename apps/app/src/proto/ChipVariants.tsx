import type { LabelSeverity } from "@kotori/contracts"
import { Platform, type StyleProp, View, type ViewStyle } from "react-native"
import { Icon, type IconName } from "../components/Icon.tsx"
import { KotoriMark } from "../components/KotoriMark.tsx"
import { Text } from "../components/Text.tsx"
import { TooltipTrigger } from "../components/Tooltip.tsx"
import type { ChipItem } from "../lib/entry.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { FREQUENCY_LEVEL, type FrequencyTier, isFrequencyChipKey, tierFromChipKey } from "./frequency.ts"
import type { GrammarTagItem } from "./grammar.ts"

const accessibleChipLabel = (item: ChipItem, aiSuffix: string) =>
  item.kotori ? `${item.label} (${aiSuffix})` : item.label

export const pebbleLift = (shadowHex: string, strong = false): ViewStyle =>
  Platform.OS === "web"
    ? {
        boxShadow: strong ? `0 6px 14px -5px ${fade(shadowHex, 0.34)}` : `0 2px 6px -2px ${fade(shadowHex, 0.14)}`
      }
    : {
        shadowColor: shadowHex,
        shadowOpacity: strong ? 0.16 : 0.05,
        shadowRadius: strong ? 6 : 3.5,
        shadowOffset: { width: 0, height: strong ? 3 : 1.5 },
        elevation: strong ? 3 : 1
      }

// ============================================================================
// 1. 4-Bar Frequency Signal Meter (`Very common` 4/4 -> `Archaic` 0/4)
// ============================================================================

const FrequencyMeter = ({
  level,
  activeColor,
  mutedColor,
  size = "md"
}: {
  readonly level: 0 | 1 | 2 | 3 | 4
  readonly activeColor: string
  readonly mutedColor: string
  readonly size?: "sm" | "md"
}) => {
  const heights = size === "sm" ? ([3, 5, 7, 9] as const) : ([3.5, 5.5, 8, 10.5] as const)
  const barWidth = size === "sm" ? 1.8 : 2
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 1.2, height: heights[3] }}>
      {heights.map((h, idx) => (
        <View
          key={h}
          style={{
            width: barWidth,
            height: h,
            borderRadius: 1,
            backgroundColor: idx < level ? activeColor : mutedColor
          }}
        />
      ))}
    </View>
  )
}

const resolveFrequencyTier = (item: ChipItem): FrequencyTier | null => {
  if (isFrequencyChipKey(item.key)) return tierFromChipKey(item.key)
  if (item.key === "common") return "common"
  if (item.key === "rare") return "rare"
  if (item.key === "arch" || item.key === "obs") return "archaic"
  return null
}

// ============================================================================
// 2. Snow Pebbles
// ============================================================================

const usePebblePalette = (severity: LabelSeverity, onTint: boolean, tier: FrequencyTier | null) => {
  const { color } = useTheme()

  // `Very common` (4/4) gets a solid `primaryDark` circular emblem with crisp white bars so top-tier
  // vocabulary stands out immediately from `Common` (3/4), `Uncommon` (2/4), `Rare` (1/4), and `Archaic` (0/4).
  if (tier === "very_common") {
    return {
      fg: color.primaryDeep,
      bg: onTint ? "#FFFFFF" : fade(color.primaryTint, 0.85),
      ring: fade(color.primaryDark, 0.22),
      emblemBg: color.primaryDark,
      meterActive: "#FFFFFF",
      meterMuted: "rgba(255, 255, 255, 0.35)"
    }
  }

  if (onTint) {
    return {
      quiet: {
        fg: color.textMuted,
        bg: "rgba(255, 255, 255, 0.92)",
        ring: fade(color.ink, 0.065),
        emblemBg: color.surfaceMuted,
        meterActive: color.textMuted,
        meterMuted: fade(color.textMuted, 0.24)
      },
      info: {
        fg: color.primaryDeep,
        bg: "#FFFFFF",
        ring: fade(color.ink, 0.065),
        emblemBg: color.primaryTint,
        meterActive: color.primaryDark,
        meterMuted: fade(color.primaryDeep, 0.22)
      },
      warning: {
        fg: color.caution,
        bg: "#FFFFFF",
        ring: fade(color.caution, 0.15),
        emblemBg: "#FDE7B2",
        meterActive: color.cautionMark,
        meterMuted: fade(color.caution, 0.22)
      },
      avoid: {
        fg: color.accent,
        bg: "#FFFFFF",
        ring: fade(color.accent, 0.17),
        emblemBg: "#FDD9E0",
        meterActive: color.accent,
        meterMuted: fade(color.accent, 0.38)
      }
    }[severity]
  }
  return {
    quiet: {
      fg: color.textMuted,
      bg: color.surfaceMuted,
      ring: fade(color.ink, 0.055),
      emblemBg: "#FFFFFF",
      meterActive: color.textMuted,
      meterMuted: fade(color.textMuted, 0.24)
    },
    info: {
      fg: color.primaryDeep,
      bg: fade(color.primaryTint, 0.72),
      ring: fade(color.primaryDark, 0.12),
      emblemBg: "#FFFFFF",
      meterActive: color.primaryDark,
      meterMuted: fade(color.primaryDeep, 0.22)
    },
    warning: {
      fg: color.caution,
      bg: "#FFF6E0",
      ring: fade(color.caution, 0.14),
      emblemBg: "#FDE5AD",
      meterActive: color.cautionMark,
      meterMuted: fade(color.caution, 0.22)
    },
    avoid: {
      fg: color.accent,
      bg: "#FFF0F3",
      ring: fade(color.accent, 0.16),
      emblemBg: "#FDD6DE",
      meterActive: color.accent,
      meterMuted: fade(color.accent, 0.38)
    }
  }[severity]
}

const PebbleEmblem = ({
  item,
  tier,
  lit,
  fg,
  bg,
  meterActive,
  meterMuted,
  compact
}: {
  readonly item: ChipItem
  readonly tier: FrequencyTier | null
  readonly lit: boolean
  readonly fg: string
  readonly bg: string
  readonly meterActive: string
  readonly meterMuted: string
  readonly compact: boolean
}) => {
  const glyphColor = lit ? "#FFFFFF" : fg
  const diameter = compact ? 17 : 19

  return (
    <View
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        backgroundColor: lit ? "rgba(255, 255, 255, 0.18)" : bg,
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {tier !== null ? (
        <FrequencyMeter
          level={FREQUENCY_LEVEL[tier]}
          activeColor={lit ? "#FFFFFF" : meterActive}
          mutedColor={lit ? "rgba(255, 255, 255, 0.28)" : meterMuted}
          size={compact ? "sm" : "md"}
        />
      ) : item.kotori ? (
        <KotoriMark size={compact ? 14 : 16} mood="happy" sparkle />
      ) : item.icon ? (
        <Icon name={item.icon === "check_circle" ? "check" : item.icon} size={12} color={glyphColor} />
      ) : item.severity === "avoid" ? (
        <Icon name="error" size={12} color={glyphColor} filled />
      ) : item.severity === "warning" ? (
        <View
          style={{
            width: 5.5,
            height: 5.5,
            borderRadius: 1.2,
            backgroundColor: lit ? "#FFFFFF" : meterActive,
            transform: [{ rotate: "45deg" }]
          }}
        />
      ) : (
        <Icon name={item.severity === "quiet" ? "menu_book" : "info"} size={11.5} color={glyphColor} />
      )}
    </View>
  )
}

const KotoriAiCap = ({ lit, fg }: { readonly lit: boolean; readonly fg: string }) => (
  <View
    style={{
      paddingHorizontal: 4.5,
      paddingVertical: 1,
      borderRadius: 4.5,
      backgroundColor: lit ? "rgba(255, 255, 255, 0.18)" : fade(fg, 0.11)
    }}
  >
    <Text
      variant="label"
      weight="bold"
      style={{ color: lit ? "#FFFFFF" : fg, fontSize: 9.5, lineHeight: 11.5, letterSpacing: 0.5 }}
    >
      AI
    </Text>
  </View>
)

export const SnowPebbleFace = ({
  item,
  onTint,
  lit = false,
  compact = false
}: {
  readonly item: ChipItem
  readonly onTint: boolean
  readonly lit?: boolean
  readonly compact?: boolean
}) => {
  const { color } = useTheme()
  const tier = resolveFrequencyTier(item)
  const palette = usePebblePalette(item.severity, onTint, tier)
  const hasTrailingAi = Boolean(item.kotori)
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: compact ? 5 : 6,
          minHeight: compact ? 24 : 28,
          paddingVertical: compact ? 2.5 : 4,
          paddingLeft: compact ? 4 : 4.5,
          paddingRight: hasTrailingAi ? (compact ? 6 : 7) : compact ? 9 : 11,
          borderRadius: 999,
          backgroundColor: lit ? color.ink : palette.bg,
          borderWidth: 1,
          borderColor: lit ? color.ink : palette.ring,
          alignSelf: "flex-start"
        },
        pebbleLift(color.shadow, lit)
      ]}
    >
      <PebbleEmblem
        item={item}
        tier={tier}
        lit={lit}
        fg={palette.fg}
        bg={palette.emblemBg}
        meterActive={palette.meterActive}
        meterMuted={palette.meterMuted}
        compact={compact}
      />
      <Text
        variant="caption"
        weight={tier === "very_common" ? "bold" : "semibold"}
        style={{
          color: lit ? color.onPrimaryDark : palette.fg,
          fontSize: compact ? 12 : 12.5,
          lineHeight: compact ? 15.5 : 17,
          flexShrink: 1
        }}
      >
        {item.label}
      </Text>
      {hasTrailingAi ? <KotoriAiCap lit={lit} fg={palette.fg} /> : null}
    </View>
  )
}

// ============================================================================
// 3. Soft-Stone Keycaps for Grammar, Fields & Orthography
// ============================================================================

const GrammarPrefix = ({ kind }: { readonly kind: GrammarTagItem["kind"] }) => {
  const { color } = useTheme()
  if (kind === "field") {
    return (
      <View
        style={{
          width: 4.5,
          height: 4.5,
          borderRadius: 1.5,
          backgroundColor: fade(color.primaryDark, 0.65)
        }}
      />
    )
  }
  if (kind === "orthography") {
    return (
      <Text jp variant="label" weight="bold" style={{ color: color.primaryDeep, fontSize: 10, lineHeight: 13 }}>
        あ
      </Text>
    )
  }
  return null
}

export const GrammarTags = ({
  items,
  onTint = false,
  compact = false
}: {
  readonly items: ReadonlyArray<GrammarTagItem>
  readonly onTint?: boolean
  readonly compact?: boolean
}) => {
  const { color } = useTheme()
  if (items.length === 0) return null

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
      {items.map((item) => (
        <View
          key={item.key}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4.5,
            minHeight: compact ? 20 : 22,
            paddingHorizontal: compact ? 6.5 : 7.5,
            paddingVertical: 2,
            borderRadius: 6,
            backgroundColor: onTint ? "rgba(255, 255, 255, 0.65)" : color.surfaceMuted,
            borderWidth: 1,
            borderColor: onTint ? fade(color.ink, 0.065) : fade(color.ink, 0.045),
            alignSelf: "flex-start"
          }}
        >
          <GrammarPrefix kind={item.kind} />
          <Text
            variant="caption"
            weight="medium"
            style={{
              color: item.kind === "field" ? color.primaryDeep : color.textMuted,
              fontSize: compact ? 11 : 11.5,
              lineHeight: compact ? 14.5 : 15.5
            }}
          >
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

// ============================================================================
// 4. Sense / Draft ChipRow (`SnowPebbleRow`) & Standalone `VariantChip`
// ============================================================================

export const SnowPebbleRow = ({
  items,
  grammar,
  onTint
}: {
  readonly items: ReadonlyArray<ChipItem>
  readonly grammar: ReadonlyArray<GrammarTagItem>
  readonly onTint: boolean
}) => {
  const { color } = useTheme()
  const { t } = useSession()
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {grammar.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <GrammarTags items={grammar} onTint={onTint} />
          {items.length > 0 ? (
            <View style={{ width: 1, height: 13, backgroundColor: fade(color.ink, 0.1), marginHorizontal: 1 }} />
          ) : null}
        </View>
      ) : null}
      {items.map((item) => (
        <TooltipTrigger
          key={item.key}
          text={item.help}
          note={item.note}
          label={accessibleChipLabel(item, t.entry.sourceKotori)}
        >
          {(open) => <SnowPebbleFace item={item} onTint={onTint} lit={open} />}
        </TooltipTrigger>
      ))}
    </View>
  )
}

export const VariantChip = ({
  label,
  tone = "neutral",
  icon,
  style
}: {
  readonly label: string
  readonly tone?: "neutral" | "primary" | "accent"
  readonly icon?: IconName
  readonly style?: StyleProp<ViewStyle>
}) => {
  const { color } = useTheme()
  const trailingArrow = icon === "arrow_forward"
  const isKotoriDraft = icon === "auto_awesome"
  const interactive = Boolean(icon) && !isKotoriDraft

  const palette = {
    neutral: {
      fg: interactive ? color.text : color.textMuted,
      bg: interactive ? "#FFFFFF" : color.surfaceMuted,
      ring: interactive ? color.outline : fade(color.ink, 0.05),
      emblemBg: color.surfaceMuted
    },
    primary: {
      fg: color.primaryDeep,
      bg: interactive ? "#FFFFFF" : color.primaryTint,
      ring: interactive ? fade(color.primaryDark, 0.18) : fade(color.primaryDark, 0.1),
      emblemBg: color.primaryTint
    },
    accent: {
      fg: color.accent,
      bg: isKotoriDraft ? "#FFFFFF" : color.accentSoft,
      ring: fade(color.accent, 0.18),
      emblemBg: color.accentSoft
    }
  }[tone]

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          minHeight: 27,
          paddingVertical: 3.5,
          paddingLeft: icon && !trailingArrow ? 6 : 10,
          paddingRight: trailingArrow ? 6 : 10.5,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: palette.ring,
          borderRadius: 999,
          alignSelf: "flex-start"
        },
        interactive || isKotoriDraft ? pebbleLift(color.shadow) : null,
        style
      ]}
    >
      {isKotoriDraft ? (
        <KotoriMark size={17} mood="happy" sparkle />
      ) : icon && !trailingArrow ? (
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: palette.emblemBg,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Icon name={icon} size={12.5} color={palette.fg} />
        </View>
      ) : null}
      <Text variant="caption" weight="semibold" style={{ color: palette.fg, lineHeight: 16.5, flexShrink: 1 }}>
        {label}
      </Text>
      {trailingArrow ? (
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: palette.emblemBg,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Icon name="arrow_forward" size={12.5} color={palette.fg} />
        </View>
      ) : null}
    </View>
  )
}

export const VariantLabelTag = ({ item, onTint = false }: { readonly item: ChipItem; readonly onTint?: boolean }) => (
  <SnowPebbleFace item={item} onTint={onTint} compact />
)
