import { Link } from "expo-router"
import { View } from "react-native"
import { useT } from "../session/SessionProvider.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

/**
 * Compact Privacy Policy and Terms of Service links (`<a href="/privacy">` and
 * `<a href="/terms">` on web, stack push on native) for Welcome, Sign-up and Settings.
 */
export const LegalLinks = () => {
  const t = useT()
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Link href="/privacy" asChild>
        <PressableScale accessibilityRole="link" hitSlop={10}>
          <Text variant="caption" color="textFaint" style={{ textDecorationLine: "underline" }}>
            {t.legal.privacy}
          </Text>
        </PressableScale>
      </Link>
      <Text variant="caption" color="textFaint">
        ·
      </Text>
      <Link href="/terms" asChild>
        <PressableScale accessibilityRole="link" hitSlop={10}>
          <Text variant="caption" color="textFaint" style={{ textDecorationLine: "underline" }}>
            {t.legal.terms}
          </Text>
        </PressableScale>
      </Link>
    </View>
  )
}
