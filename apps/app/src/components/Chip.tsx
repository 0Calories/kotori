import { type StyleProp, View, type ViewStyle } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { Icon, type IconName } from "./Icon.tsx"
import { Text } from "./Text.tsx"

/** neutral: a quiet tag. primary: the theme's colour on its tint. accent: a rose warning on blush. */
export type Tone = "neutral" | "primary" | "accent"

export const useTone = (tone: Tone) => {
  const { color } = useTheme()
  return {
    neutral: { fg: color.text, bg: "transparent", ring: color.border },
    primary: { fg: color.primaryDeep, bg: color.primaryTint, ring: color.primaryTint },
    accent: { fg: color.accent, bg: color.accentSoft, ring: color.accentSoft }
  }[tone]
}

export interface ChipColors {
  readonly fg: string
  readonly bg: string
  /** A hairline of the chip's own colour, so a pale fill keeps its edge on white and on tint. */
  readonly ring: string
  /** The dot that leads a chip which explains itself. */
  readonly dot?: string
}

/** A fill of `fg`'s own hue needs only a faint ring of it to hold its shape. */
export const chipRing = (fg: string) => fade(fg, 0.1)

/** Every tone's chip colours, for chips that build their own colours from them (`LabelChips`). */
export const useChipPalette = (): Record<Tone, ChipColors> => {
  const { color } = useTheme()
  return {
    // A wash of ink rather than a grey: it sits on snow, white, stone and the hero's tint alike.
    neutral: { fg: color.textMuted, bg: fade(color.ink, 0.055), ring: "transparent" },
    primary: { fg: color.primaryDeep, bg: color.primaryTint, ring: chipRing(color.primaryDeep) },
    accent: { fg: color.accent, bg: color.accentSoft, ring: chipRing(color.accent) }
  }
}

const DOT = 6

/**
 * The pill every chip is drawn as: a soft fill, a hairline of its own colour, and semibold text.
 * `dot` leads a chip that explains itself; `lit` deepens the ring while its explanation is open.
 */
export const ChipFace = ({
  label,
  colors,
  icon,
  dot = false,
  lit = false,
  style
}: {
  readonly label: string
  readonly colors: ChipColors
  readonly icon?: IconName
  readonly dot?: boolean
  readonly lit?: boolean
  readonly style?: StyleProp<ViewStyle>
}) => {
  const { space, radius } = useTheme()
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: icon ? space.xs : 6,
          minHeight: 28,
          paddingVertical: 5,
          paddingLeft: icon ? space.sm : dot ? 10 : 11,
          paddingRight: 11,
          backgroundColor: colors.bg,
          borderWidth: 1,
          borderColor: lit ? fade(colors.fg, 0.55) : colors.ring,
          borderRadius: radius.sm,
          alignSelf: "flex-start"
        },
        style
      ]}
    >
      {icon ? (
        <Icon name={icon} size={15} color={colors.fg} filled />
      ) : dot ? (
        <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.dot ?? colors.fg }} />
      ) : null}
      <Text variant="caption" weight="semibold" style={{ color: colors.fg, lineHeight: 16, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  )
}

export const Chip = ({
  label,
  tone = "neutral",
  icon,
  style
}: {
  readonly label: string
  readonly tone?: Tone
  readonly icon?: IconName
  readonly style?: StyleProp<ViewStyle>
}) => <ChipFace label={label} colors={useChipPalette()[tone]} icon={icon} style={style} />
