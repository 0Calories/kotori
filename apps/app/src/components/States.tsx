import { View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { ApiError } from "../api/client.ts"
import { useT } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Button } from "./Button.tsx"
import { Mascot, type Mood } from "./Mascot.tsx"
import { Text } from "./Text.tsx"

/** Kotori with a message: loading, empty and error states all use this. */
export const MascotMessage = (
  { mood = "curious", title, body, size = 110, children }: {
    readonly mood?: Mood
    readonly title?: string
    readonly body?: string
    readonly size?: number
    readonly children?: React.ReactNode
  }
) => {
  const theme = useTheme()
  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ alignItems: "center", gap: theme.space.md, paddingVertical: theme.space.xl }}>
      <Mascot size={size} mood={mood} />
      {title ? <Text variant="heading" align="center">{title}</Text> : null}
      {body ? <Text color="textMuted" align="center" style={{ maxWidth: 360 }}>{body}</Text> : null}
      {children}
    </Animated.View>
  )
}

export const ErrorState = ({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) => {
  const t = useT()
  const message = error instanceof ApiError
    ? error.tag === "Offline" ? t.common.offline : error.message || t.common.somethingWrong
    : t.common.somethingWrong
  return (
    <MascotMessage mood="oops" body={message}>
      {onRetry ? <Button label={t.common.retry} variant="soft" icon="refresh" onPress={onRetry} /> : null}
    </MascotMessage>
  )
}

export const Dots = () => {
  const { color } = useTheme()
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[0, 1, 2].map((i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.textFaint }} />)}
    </View>
  )
}
