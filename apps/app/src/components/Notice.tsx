import { View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { theme } from "../theme/tokens.ts"
import { Card } from "./Card.tsx"
import { Icon } from "./Icon.tsx"
import { Text } from "./Text.tsx"

/** A one-line message under a form: what went wrong, or that something worked. */
export const Notice = ({
  message,
  tone = "accent"
}: {
  readonly message: string | null
  readonly tone?: "accent" | "primary"
}) => {
  const { color } = theme
  if (message === null) return null
  return (
    <Animated.View entering={FadeIn.duration(200)} accessibilityLiveRegion="polite">
      <Card tone={tone} style={{ paddingVertical: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Icon
            name={tone === "accent" ? "error" : "check_circle"}
            size={18}
            color={tone === "accent" ? color.accent : color.primaryDark}
          />
          <Text variant="small" style={{ flex: 1 }}>
            {message}
          </Text>
        </View>
      </Card>
    </Animated.View>
  )
}
