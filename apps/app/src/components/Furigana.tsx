import { parseFurigana } from "@kotori/domain"
import { View } from "react-native"
import { usePreference } from "../session/preferences.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import type { Palette } from "../theme/tokens.ts"
import { Text } from "./Text.tsx"

interface Unit {
  readonly base: string
  readonly reading: string | null
}

/**
 * Japanese text with readings above the kanji. Furigana arrives inline as
 * `{漢字|かんじ}`; every other character is laid out individually so lines can
 * wrap anywhere, as Japanese text does.
 */
export const Furigana = (
  { text, furigana, size = 20, color = "text", center }: {
    readonly text: string
    readonly furigana?: string | null
    readonly size?: number
    readonly color?: keyof Palette
    readonly center?: boolean
  }
) => {
  const theme = useTheme()
  const [showFurigana] = usePreference("furigana", true)

  if (!showFurigana || !furigana) {
    return <Text jp size={size} color={color} align={center ? "center" : undefined} selectable>{text}</Text>
  }

  const units = parseFurigana(furigana).flatMap((segment): Array<Unit> =>
    segment.reading !== null
      ? [{ base: segment.text, reading: segment.reading }]
      : Array.from(segment.text, (char) => ({ base: char, reading: null }))
  )
  const rubySize = Math.max(Math.round(size * 0.48), 9)

  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: center ? "center" : "flex-start" }}
      accessible
      accessibilityLabel={text}
    >
      {units.map((unit, index) => (
        <View key={index} style={{ alignItems: "center" }}>
          <Text jp size={rubySize} style={{ color: theme.color.textMuted, lineHeight: rubySize * 1.25 }}>
            {unit.reading ?? "​"}
          </Text>
          <Text jp size={size} color={color}>{unit.base}</Text>
        </View>
      ))}
    </View>
  )
}
