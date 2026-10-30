import { type StyleProp, View, type ViewStyle } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Icon, type IconName } from "./Icon.tsx"
import { Text } from "./Text.tsx"

/** neutral: an outlined tag. primary: a green pill on tint. accent: a rose warning on blush. */
export type Tone = "neutral" | "primary" | "accent"

export const useTone = (tone: Tone) => {
  const { color } = useTheme()
  return {
    neutral: { fg: color.text, bg: "transparent", ring: color.border },
    primary: { fg: color.primaryDeep, bg: color.primaryTint, ring: color.primaryTint },
    accent: { fg: color.accent, bg: color.accentSoft, ring: color.accentSoft }
  }[tone]
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
}) => {
  const { fg, bg, ring } = useTone(tone)
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          minHeight: 26,
          paddingVertical: 4,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: ring,
          borderRadius: 13,
          paddingHorizontal: icon ? 9 : 10,
          alignSelf: "flex-start"
        },
        style
      ]}
    >
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      <Text variant="caption" style={{ color: fg, lineHeight: 16, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  )
}
