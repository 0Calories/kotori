import type { Language } from "@kotori/domain"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { Button } from "../src/components/Button.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { PressableScale } from "../src/components/PressableScale.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { ErrorState } from "../src/components/States.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

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
  const { color, radius, shadow } = useTheme()
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
          borderColor: selected ? color.primary : color.border
        },
        shadow(selected ? 2 : 1)
      ]}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          backgroundColor: selected ? color.primary : color.primarySoft,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Text jp size={26} style={{ color: selected ? color.onPrimary : color.primary, fontWeight: "700" }}>
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
          borderColor: selected ? color.primary : color.border,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.primary }} /> : null}
      </View>
    </PressableScale>
  )
}

export default function Onboarding() {
  const { t, updateProfile } = useSession()
  const theme = useTheme()
  const [native, setNative] = useState<Language | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const start = async () => {
    if (native === null) return
    setBusy(true)
    setError(null)
    try {
      // Becomes the post-approval language picker in the app step.
      await updateProfile({ nativeLanguage: native })
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Screen bottomInset={40}>
      <View style={{ alignItems: "center", gap: theme.space.md, marginTop: theme.space.xxl }}>
        <Animated.View entering={FadeInDown.duration(500)}>
          <Mascot size={170} mood="happy" />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(120).duration(500)} style={{ alignItems: "center", gap: 6 }}>
          <Text variant="display" align="center">
            {t.onboarding.title}
          </Text>
          <Text color="textMuted" align="center" style={{ maxWidth: 340 }}>
            {t.onboarding.subtitle}
          </Text>
        </Animated.View>
      </View>
      <Animated.View
        entering={FadeInDown.delay(260).duration(500)}
        style={{ gap: theme.space.md, marginTop: theme.space.xl }}
      >
        <Text variant="label" color="textMuted" style={{ paddingHorizontal: 4 }}>
          {t.onboarding.question.toUpperCase()}
        </Text>
        <Choice
          glyph="あ"
          title={t.onboarding.learnJapanese}
          hint={t.onboarding.learnJapaneseHint}
          selected={native === "en"}
          onPress={() => setNative("en")}
        />
        <Choice
          glyph="A"
          title={t.onboarding.learnEnglish}
          hint={t.onboarding.learnEnglishHint}
          selected={native === "ja"}
          onPress={() => setNative("ja")}
        />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(380).duration(500)} style={{ marginTop: theme.space.lg }}>
        <Button
          label={busy ? t.onboarding.starting : t.onboarding.start}
          size="lg"
          full
          icon="arrow-forward"
          disabled={native === null}
          loading={busy}
          onPress={start}
        />
      </Animated.View>
      {error ? <ErrorState error={error} onRetry={start} /> : null}
    </Screen>
  )
}
