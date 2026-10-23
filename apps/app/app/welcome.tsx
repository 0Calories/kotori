import { useRouter } from "expo-router"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { Button } from "../src/components/Button.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useT } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

export default function Welcome() {
  const t = useT()
  const theme = useTheme()
  const router = useRouter()
  return (
    <Screen bottomInset={40}>
      <View style={{ alignItems: "center", gap: theme.space.md, marginTop: theme.space.xxxl }}>
        <Animated.View entering={FadeInDown.duration(500)}>
          <Mascot size={190} mood="happy" />
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
        <Button
          label={t.auth.createAccount}
          size="lg"
          full
          icon="auto_awesome"
          onPress={() => router.push("/sign-up")}
        />
        <Button label={t.auth.haveAccount} variant="secondary" size="lg" full onPress={() => router.push("/sign-in")} />
        <Text variant="caption" color="textFaint" align="center" style={{ marginTop: theme.space.sm }}>
          {t.auth.beta}
        </Text>
      </Animated.View>
    </Screen>
  )
}
