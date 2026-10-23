import { useEffect } from "react"
import { View } from "react-native"
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated"
import Svg, { Circle } from "react-native-svg"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export const ScoreRing = ({
  score,
  color,
  size = 96
}: {
  readonly score: number
  readonly color: string
  readonly size?: number
}) => {
  const theme = useTheme()
  const stroke = 9
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = withTiming(score / 100, { duration: 900, easing: Easing.out(Easing.cubic) })
  }, [score])

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }))

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.color.surfaceMuted} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
        />
      </Svg>
      <Text variant="title" style={{ color }}>
        {score}
      </Text>
    </View>
  )
}
