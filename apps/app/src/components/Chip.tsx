import Ionicons from "@expo/vector-icons/Ionicons"
import { type StyleProp, View, type ViewStyle } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

export type Tone = "neutral" | "rose" | "sky" | "matcha" | "yuzu" | "plum" | "lavender"

export const useTone = (tone: Tone) => {
  const { color } = useTheme()
  return {
    neutral: { fg: color.textMuted, bg: color.surfaceMuted },
    rose: { fg: color.primary, bg: color.primarySoft },
    sky: { fg: color.sky, bg: color.skySoft },
    matcha: { fg: color.matcha, bg: color.matchaSoft },
    yuzu: { fg: color.yuzu, bg: color.yuzuSoft },
    plum: { fg: color.plum, bg: color.plumSoft },
    lavender: { fg: color.lavender, bg: color.lavenderSoft }
  }[tone]
}

export const Chip = (
  { label, tone = "neutral", icon, style }: {
    readonly label: string
    readonly tone?: Tone
    readonly icon?: keyof typeof Ionicons.glyphMap
    readonly style?: StyleProp<ViewStyle>
  }
) => {
  const { fg, bg } = useTone(tone)
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text variant="caption" style={{ color: fg }}>{label}</Text>
    </View>
  )
}
