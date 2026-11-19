import { useRouter } from "expo-router"
import { View } from "react-native"
import { Button } from "../src/components/Button.tsx"
import { LegalLinks } from "../src/components/LegalLinks.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useT } from "../src/session/SessionProvider.tsx"
import { theme } from "../src/theme/tokens.ts"

export default function Welcome() {
  const t = useT()
  const router = useRouter()
  return (
    <Screen bottomInset={40}>
      <View style={{ alignItems: "center", gap: theme.space.md, marginTop: theme.space.xxxl }}>
        <Mascot size={190} mood="happy" />
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text variant="display" align="center">
            {t.onboarding.title}
          </Text>
          <Text color="textMuted" align="center" style={{ maxWidth: 340 }}>
            {t.onboarding.subtitle}
          </Text>
        </View>
      </View>
      <View style={{ gap: theme.space.md, marginTop: theme.space.xl }}>
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
        <LegalLinks />
      </View>
    </Screen>
  )
}
