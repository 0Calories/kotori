import type { Language } from "@kotori/domain"
import { View } from "react-native"
import { useT } from "../session/SessionProvider.tsx"
import { theme } from "../theme/tokens.ts"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

const Choice = ({
  glyph,
  title,
  hint,
  selected,
  onPress
}: {
  readonly glyph: string
  readonly title: string
  readonly hint: string
  readonly selected: boolean
  readonly onPress: () => void
}) => {
  const { color, radius, shadow } = theme
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          padding: 18,
          borderRadius: radius.lg,
          backgroundColor: color.surface,
          borderWidth: 2,
          borderColor: selected ? color.primaryDark : color.border
        },
        shadow(selected ? 2 : 1)
      ]}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          backgroundColor: selected ? color.primary : color.primaryTint,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Text mincho size={28} style={{ color: selected ? color.onPrimary : color.primaryDeep }}>
          {glyph}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="heading">{title}</Text>
        <Text variant="small" color="textMuted">
          {hint}
        </Text>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? color.primaryDark : color.border,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {selected ? (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.primaryDark }} />
        ) : null}
      </View>
    </PressableScale>
  )
}

/** The two directions Kotori teaches, picked by the learner's native language. */
export const LanguageChoice = ({
  value,
  onChange
}: {
  readonly value: Language | null
  readonly onChange: (native: Language) => void
}) => {
  const t = useT()
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
      <Choice
        glyph="あ"
        title={t.onboarding.learnJapanese}
        hint={t.onboarding.learnJapaneseHint}
        selected={value === "en"}
        onPress={() => onChange("en")}
      />
      <Choice
        glyph="A"
        title={t.onboarding.learnEnglish}
        hint={t.onboarding.learnEnglishHint}
        selected={value === "ja"}
        onPress={() => onChange("ja")}
      />
    </View>
  )
}
