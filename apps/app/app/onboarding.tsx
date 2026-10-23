import type { Language } from "@kotori/domain"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { Button } from "../src/components/Button.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { LanguageChoice } from "../src/components/LanguageChoice.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { ErrorState } from "../src/components/States.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

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
      // Approved learners who signed up before picking a language land here once.
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
        <LanguageChoice value={native} onChange={setNative} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(380).duration(500)} style={{ marginTop: theme.space.lg }}>
        <Button
          label={busy ? t.onboarding.starting : t.onboarding.start}
          size="lg"
          full
          icon="arrow_forward"
          disabled={native === null}
          loading={busy}
          onPress={start}
        />
      </Animated.View>
      {error ? <ErrorState error={error} onRetry={start} /> : null}
    </Screen>
  )
}
