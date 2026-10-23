import { useEffect, useId, useState } from "react"
import { View } from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming
} from "react-native-reanimated"
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop, Text as SvgText } from "react-native-svg"
import { centering, type Mood, palette, shapes } from "../mascot/geometry.ts"

export type { Mood }

const Eyes = ({ mood, blinking }: { readonly mood: Mood; readonly blinking: boolean }) => {
  if (mood === "happy" || mood === "celebrate") {
    return shapes.eyes.map((e) => (
      <Path
        key={e.cx}
        d={`M${e.cx - 7} ${e.cy + 2} Q ${e.cx} ${e.cy - 7} ${e.cx + 7} ${e.cy + 2}`}
        stroke={palette.ink}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    ))
  }
  if (mood === "sleepy" || blinking) {
    return shapes.eyes.map((e) => (
      <Path
        key={e.cx}
        d={`M${e.cx - 7} ${e.cy + 1} Q ${e.cx} ${e.cy + 5} ${e.cx + 7} ${e.cy + 1}`}
        stroke={palette.ink}
        strokeWidth={3.5}
        strokeLinecap="round"
        fill="none"
      />
    ))
  }
  // Thinking: eyes glance up and to the side.
  const dx = mood === "thinking" ? -2.5 : 0
  const dy = mood === "thinking" ? -3 : 0
  return shapes.eyes.map((e) => (
    <G key={e.cx}>
      <Circle cx={e.cx + dx} cy={e.cy + dy} r={mood === "oops" ? 7.5 : 7} fill={palette.ink} />
      <Circle cx={e.cx + dx + 2.5} cy={e.cy + dy - 2.5} r={2.3} fill={palette.white} />
    </G>
  ))
}

/**
 * Kotori, the shima enaga. Bobs gently, blinks now and then, and changes
 * expression with `mood`. Stays still when the system asks for reduced motion.
 */
export const Mascot = ({ size = 120, mood = "curious" }: { readonly size?: number; readonly mood?: Mood }) => {
  const reduceMotion = useReducedMotion()
  // Gradient ids are global on the web; a shared id breaks once the defining screen is hidden.
  const gradientId = `kotori-body-${useId().replace(/[^\w-]/g, "")}`
  const bob = useSharedValue(0)
  const hop = useSharedValue(0)
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    bob.value = withRepeat(
      withSequence(
        withTiming(-size * 0.025, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })
      ),
      -1
    )
  }, [reduceMotion, size])

  useEffect(() => {
    if (reduceMotion || mood !== "celebrate") return
    hop.value = withSequence(
      withSpring(-size * 0.12, { duration: 280, dampingRatio: 0.5 }),
      withSpring(0, { duration: 420, dampingRatio: 0.45 })
    )
  }, [mood, reduceMotion, size])

  useEffect(() => {
    if (reduceMotion || mood === "sleepy" || mood === "happy" || mood === "celebrate") return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          setBlinking(true)
          timer = setTimeout(() => {
            setBlinking(false)
            schedule()
          }, 140)
        },
        2600 + Math.random() * 3200
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [mood, reduceMotion])

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value + hop.value }] }))
  // Keep the outline about a pixel wide at small sizes so the white bird reads on light backgrounds.
  const outline = Math.max(2, 240 / size)
  const { body } = shapes
  const celebrating = mood === "celebrate"

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="image"
      accessibilityLabel="Kotori the long-tailed tit"
    >
      <Animated.View style={style}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id={gradientId} cx="42%" cy="36%" r="70%">
              <Stop offset="0%" stopColor={palette.white} />
              <Stop offset="72%" stopColor={palette.cream} />
              <Stop offset="100%" stopColor={palette.shade} />
            </RadialGradient>
          </Defs>
          <G transform={`translate(${centering.x} ${centering.y})`}>
            <Path d={shapes.tail} fill={palette.ink} />
            <Path
              d={shapes.tailHighlight}
              stroke={palette.white}
              strokeOpacity={0.35}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
            />
            <Path d={shapes.feet} stroke={palette.ink} strokeWidth={3.5} strokeLinecap="round" />
            <Ellipse
              cx={body.cx}
              cy={body.cy}
              rx={body.rx}
              ry={body.ry}
              fill={`url(#${gradientId})`}
              stroke={palette.outline}
              strokeWidth={outline}
            />
            <Path d={shapes.tuft} fill="none" stroke={palette.outline} strokeWidth={2.5} strokeLinecap="round" />
            {celebrating ? (
              <>
                <Path d={shapes.wingUp} fill={palette.ink} />
                <Path d={shapes.wingUpShoulder} fill={palette.rose} />
              </>
            ) : (
              <>
                <Path d={shapes.wing} fill={palette.ink} />
                <Path d={shapes.wingShoulder} fill={palette.rose} />
                <Path
                  d={shapes.wingEdge}
                  stroke={palette.white}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  opacity={0.85}
                />
              </>
            )}
            {shapes.cheeks.map((c) => (
              <Ellipse
                key={c.cx}
                cx={c.cx}
                cy={c.cy}
                rx={c.rx}
                ry={c.ry}
                fill={palette.blush}
                opacity={mood === "happy" || celebrating ? 0.8 : 0.6}
              />
            ))}
            <Eyes mood={mood} blinking={blinking} />
            <Path d={shapes.beak} fill={palette.ink} stroke={palette.ink} strokeWidth={2} strokeLinejoin="round" />
            {mood === "oops" ? <Path d="M146 64 q 7 10 0 15 q -7 -5 0 -15 Z" fill={palette.sky} opacity={0.9} /> : null}
            {mood === "sleepy" ? (
              <SvgText x={136} y={58} fontSize={22} fontWeight="bold" fill={palette.sky}>
                z
              </SvgText>
            ) : null}
            {mood === "thinking" ? (
              <G opacity={0.85}>
                <Circle cx={150} cy={52} r={4} fill={palette.outline} />
                <Circle cx={163} cy={40} r={6} fill={palette.outline} />
                <Circle cx={180} cy={25} r={9} fill={palette.outline} />
              </G>
            ) : null}
            {celebrating ? (
              <G fill={palette.rose}>
                <Path d="M30 40 l 3 8 l 8 3 l -8 3 l -3 8 l -3 -8 l -8 -3 l 8 -3 Z" />
                <Path d="M168 30 l 2 6 l 6 2 l -6 2 l -2 6 l -2 -6 l -6 -2 l 6 -2 Z" />
              </G>
            ) : null}
          </G>
        </Svg>
      </Animated.View>
    </View>
  )
}
