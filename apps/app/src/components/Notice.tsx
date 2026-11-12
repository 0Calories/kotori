import { View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Button } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { Icon } from "./Icon.tsx"
import { Text } from "./Text.tsx"

/**
 * A one-line message under a form, or above content that is still showing: what went wrong, or
 * that something worked. `action` adds a small button at the end, such as a way to try again.
 */
export const Notice = ({
  message,
  tone = "accent",
  action
}: {
  readonly message: string | null
  readonly tone?: "accent" | "primary"
  readonly action?: { readonly label: string; readonly onPress: () => void }
}) => {
  const { color } = useTheme()
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
          {action ? (
            <Button label={action.label} size="sm" variant="ghost" icon="refresh" onPress={action.onPress} />
          ) : null}
        </View>
      </Card>
    </Animated.View>
  )
}
