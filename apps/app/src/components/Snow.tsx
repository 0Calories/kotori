import { useEffect, useId } from "react"
import { StyleSheet, View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated"
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg"
import { useTheme } from "../theme/ThemeProvider.tsx"

const LAYERS = [
  { width: 53, height: 47, x: 0.23, y: 0.31, r: 1.7, fall: 22, drift: 4 },
  { width: 31, height: 37, x: 0.71, y: 0.63, r: 1.1, fall: 14, drift: -3 },
  { width: 89, height: 79, x: 0.41, y: 0.77, r: 2.3, fall: 36, drift: 6 },
  { width: 127, height: 113, x: 0.83, y: 0.19, r: 2, fall: 28, drift: -5 }
] as const

type Layer = (typeof LAYERS)[number]

const loopMs = (distance: number, speed: number) => Math.round((Math.abs(distance) / Math.abs(speed)) * 1000)

// Translating by one exact pattern tile makes the linear repeat wrap seamlessly.
const FlakeLayer = ({ layer }: { readonly layer: Layer }) => {
  const { color } = useTheme()
  const reduceMotion = useReducedMotion()
  const fall = useSharedValue(0)
  const drift = useSharedValue(0)
  const id = `kotori-snow-${useId().replace(/[^\w-]/g, "")}`
  const driftDistance = Math.sign(layer.drift) * layer.width

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(fall)
      cancelAnimation(drift)
      fall.value = 0
      drift.value = 0
      return
    }
    fall.value = 0
    drift.value = 0
    fall.value = withRepeat(
      withTiming(layer.height, { duration: loopMs(layer.height, layer.fall), easing: Easing.linear }),
      -1,
      false
    )
    drift.value = withRepeat(
      withTiming(driftDistance, { duration: loopMs(driftDistance, layer.drift), easing: Easing.linear }),
      -1,
      false
    )
    return () => {
      cancelAnimation(fall)
      cancelAnimation(drift)
    }
  }, [drift, driftDistance, fall, layer.drift, layer.fall, layer.height, reduceMotion])

  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value }, { translateY: fall.value }]
  }))

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top: -layer.height,
          bottom: 0,
          // Extra pattern on the side the sheet moves away from, so the hero never shows a gap.
          left: layer.drift > 0 ? -layer.width : 0,
          right: layer.drift > 0 ? 0 : -layer.width
        },
        motion
      ]}
    >
      {/* react-native-svg forwards unknown props to the DOM on web, so use aria-hidden instead of accessible={false}. */}
      <Svg width="100%" height="100%" style={{ width: "100%", height: "100%" }} pointerEvents="none" aria-hidden>
        <Defs>
          <Pattern id={id} width={layer.width} height={layer.height} patternUnits="userSpaceOnUse">
            <Circle
              cx={layer.x * layer.width}
              cy={layer.y * layer.height}
              r={layer.r}
              fill={color.surface}
              fillOpacity={1}
              stroke={color.primaryDark}
              strokeOpacity={0.18}
              strokeWidth={0.8}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

export const Snow = () => (
  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
    {LAYERS.map((layer) => (
      <FlakeLayer key={`${layer.width}x${layer.height}`} layer={layer} />
    ))}
  </View>
)
