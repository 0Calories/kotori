import { useEffect, useState } from "react"
import { View } from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring
} from "react-native-reanimated"
import Svg, { Circle, Ellipse, G, Path, Text as SvgText } from "react-native-svg"
import { type Mood, palette, shapes } from "../mascot/geometry.ts"

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
  const scale = mood === "oops" ? 1.08 : 1
  const { catchlight } = shapes
  return shapes.eyes.map((e) => (
    <G key={e.cx}>
      <Ellipse cx={e.cx + dx} cy={e.cy + dy} rx={e.rx * scale} ry={e.ry * scale} fill={palette.ink} />
      <Circle cx={e.cx + dx + catchlight.dx} cy={e.cy + dy + catchlight.dy} r={catchlight.r} fill={palette.white} />
    </G>
  ))
}

const Foot = ({ d }: { readonly d: string }) => (
  <Path d={d} stroke={palette.ink} strokeWidth={shapes.feet.width} strokeLinecap="round" />
)

/**
 * Kotori, the shima enaga. Blinks now and then and changes expression with
 * `mood`. Stays still when the system asks for reduced motion.
 */
export const Mascot = ({ size = 120, mood = "curious" }: { readonly size?: number; readonly mood?: Mood }) => {
  const reduceMotion = useReducedMotion()
  const hop = useSharedValue(0)
  const [blinking, setBlinking] = useState(false)

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

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: hop.value }] }))
  const celebrating = mood === "celebrate"

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="image"
      accessibilityLabel="Kotori the long-tailed tit"
    >
      <Animated.View style={style}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Path d={shapes.tail} fill={palette.ink} />
          <Foot d={shapes.feet.back} />
          {shapes.tuft.map((t) => (
            <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r} fill={palette.cream} />
          ))}
          <Path d={shapes.body} fill={palette.cream} />
          <Path d={shapes.shade} fill={palette.shade} />
          <Path d={shapes.belly} fill={palette.white} fillOpacity={0.4} />
          <Foot d={shapes.feet.front} />
          <Path d={celebrating ? shapes.wingUp : shapes.wing} fill={palette.ink} />
          {shapes.cheeks.map((c) => (
            <Ellipse key={c.cx} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={palette.blush} />
          ))}
          <Eyes mood={mood} blinking={blinking} />
          <Path d={shapes.beak} fill={palette.ink} />
          {mood === "oops" ? <Path d="M29 46 q 7 10 0 15 q -7 -5 0 -15 Z" fill={palette.sky} /> : null}
          {mood === "sleepy" ? (
            <SvgText x={25} y={38} fontSize={22} fontWeight="bold" fill={palette.sky}>
              z
            </SvgText>
          ) : null}
          {mood === "thinking" ? (
            <G opacity={0.85}>
              <Circle cx={40} cy={37} r={4} fill={palette.shade} />
              <Circle cx={29} cy={24} r={5.5} fill={palette.shade} />
              <Circle cx={15} cy={10} r={7.5} fill={palette.shade} />
            </G>
          ) : null}
          {celebrating ? (
            <G fill={palette.blush}>
              <Path d="M158 9 l 3 8 l 8 3 l -8 3 l -3 8 l -3 -8 l -8 -3 l 8 -3 Z" />
              <Path d="M28 20 l 2 6 l 6 2 l -6 2 l -2 6 l -2 -6 l -6 -2 l 6 -2 Z" />
            </G>
          ) : null}
        </Svg>
      </Animated.View>
    </View>
  )
}
