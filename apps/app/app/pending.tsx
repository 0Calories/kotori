import { useEffect } from "react"
import Animated, { FadeInDown } from "react-native-reanimated"
import { Button } from "../src/components/Button.tsx"
import { ConfirmEmail } from "../src/components/ConfirmEmail.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

/** How often the screen checks whether the admin has approved the account. */
const POLL_MS = 30_000

export default function Pending() {
  const { t, refresh, signOut } = useSession()
  const theme = useTheme()

  // Approval happens in the admin's CLI; check back now and then, and move on when it lands.
  useEffect(() => {
    const timer = setInterval(() => void refresh().catch(() => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <Screen bottomInset={40}>
      <Animated.View
        entering={FadeInDown.duration(500)}
        style={{ alignItems: "center", gap: theme.space.md, marginTop: theme.space.xl }}
      >
        <Mascot size={150} mood="sleepy" />
        <Text variant="title" align="center">
          {t.pending.title}
        </Text>
        <Text color="textMuted" align="center" style={{ maxWidth: 360 }}>
          {t.pending.body}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(150).duration(500)} style={{ gap: theme.space.lg }}>
        <ConfirmEmail />
        <Button label={t.pending.signOut} variant="secondary" icon="logout" onPress={() => void signOut()} />
      </Animated.View>
    </Screen>
  )
}
