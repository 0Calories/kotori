import Ionicons from "@expo/vector-icons/Ionicons"
import { View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Card } from "./Card.tsx"
import { Text } from "./Text.tsx"

/** A one-line message under a form: what went wrong, or that something worked. */
export const Notice = ({
  message,
  tone = "plum"
}: {
  readonly message: string | null
  readonly tone?: "plum" | "matcha"
}) => {
  const { color } = useTheme()
  if (message === null) return null
  return (
    <Animated.View entering={FadeIn.duration(200)} accessibilityLiveRegion="polite">
      <Card tone={tone} style={{ paddingVertical: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons
            name={tone === "plum" ? "alert-circle" : "checkmark-circle"}
            size={18}
            color={tone === "plum" ? color.plum : color.matcha}
          />
          <Text variant="small" style={{ flex: 1 }}>
            {message}
          </Text>
        </View>
      </Card>
    </Animated.View>
  )
}
