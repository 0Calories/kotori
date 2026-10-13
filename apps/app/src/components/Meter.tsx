import { View } from "react-native"
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

/** A labelled scale with a marker, for formality and speech ↔ writing. */
export const Meter = (
  { title, labels, position, value, faded }: {
    readonly title: string
    readonly labels: ReadonlyArray<string>
    /** 0..1 along the scale. */
    readonly position: number
    readonly value: string
    /** Low-confidence judgments are shown lighter. */
    readonly faded?: boolean
  }
) => {
  const { color, radius } = useTheme()
  const clamped = Math.min(Math.max(position, 0), 1)
  const marker = useAnimatedStyle(() => ({ left: withSpring(`${clamped * 100}%`, { duration: 600, dampingRatio: 0.8 }) }))
  return (
    <View style={{ gap: 8, opacity: faded ? 0.6 : 1 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text variant="label" color="textMuted">{title.toUpperCase()}</Text>
        <Text variant="strong" color="primary">{value}</Text>
      </View>
      <View style={{ height: 10, justifyContent: "center" }}>
        <View style={{ flexDirection: "row", gap: 3, height: 6 }}>
          {labels.map((label, index) => (
            <View
              key={label}
              style={{
                flex: 1,
                borderRadius: radius.pill,
                backgroundColor: Math.round(clamped * (labels.length - 1)) === index ? color.primary : color.border
              }}
            />
          ))}
        </View>
        <Animated.View
          style={[{
            position: "absolute",
            width: 14,
            height: 14,
            marginLeft: -7,
            borderRadius: 7,
            backgroundColor: color.surface,
            borderWidth: 3,
            borderColor: color.primary
          }, marker]}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="caption" color="textFaint">{labels[0]}</Text>
        <Text variant="caption" color="textFaint">{labels[labels.length - 1]}</Text>
      </View>
    </View>
  )
}
