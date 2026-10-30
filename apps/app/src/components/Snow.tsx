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

/**
 * Tile, flake, and motion for one depth layer.
 *
 * Nothing in the repo, tokens, or comments specifies the animation. `fall` and
 * `drift` are pixels per second chosen so the field reads as light snow:
 * larger flakes fall faster, and neighboring layers drift in opposite
 * directions. A real spec should replace these numbers.
 */
const LAYERS = [
  { width: 53, height: 47, x: 0.23, y: 0.31, r: 1.7, fall: 22, drift: 4 },
  { width: 31, height: 37, x: 0.71, y: 0.63, r: 1.1, fall: 14, drift: -3 },
  { width: 89, height: 79, x: 0.41, y: 0.77, r: 2.3, fall: 36, drift: 6 },
  { width: 127, height: 113, x: 0.83, y: 0.19, r: 2, fall: 28, drift: -5 }
] as const

type Layer = (typeof LAYERS)[number]

const loopMs = (distance: number, speed: number) => Math.round((Math.abs(distance) / Math.abs(speed)) * 1000)

/**
 * One tiled sheet, translated by exactly its own tile and looped.
 * Shifting a repeating pattern by one period lands on the same picture, so the
 * restart is invisible. The view hangs one tile outside the hero; the hero
 * clips it, and the sheet still covers the hero at both ends of the loop.
 */
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
    // Restart from the origin so a rerun is still exactly one tile long.
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
      {/* `aria-hidden` rather than `accessible={false}`: react-native-svg passes unknown
          props straight to the DOM element on the web, where `accessible` isn't an attribute. */}
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

/**
 * Light snowfall over a tinted hero. Purely decorative, and it ignores touches.
 *
 * An `<svg>` is a replaced element, so absolute edges leave the browser's
 * default 300×150 viewport. Each sheet is a view that does stretch past the
 * hero, with the svg at 100% of that view, so a resize keeps the field full.
 * Reduced motion leaves the texture still. The running translations are
 * cancelled on unmount.
 */
export const Snow = () => (
  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
    {LAYERS.map((layer) => (
      <FlakeLayer key={`${layer.width}x${layer.height}`} layer={layer} />
    ))}
  </View>
)
