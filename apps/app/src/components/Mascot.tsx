import { type ComponentProps, type ReactNode, useEffect, useMemo } from "react"
import { StyleSheet, View } from "react-native"
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming
} from "react-native-reanimated"
import Svg, { Circle, Ellipse, G, Path, Text as SvgText } from "react-native-svg"
import { type Mood, palette, shapes } from "../mascot/geometry.ts"
import { type ClipName, clips, combine, entrances, type Part, poseAt, viewTransform } from "../mascot/motion.ts"

export type { Mood }

const Eyes = ({ mood }: { readonly mood: Mood }) => {
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
  if (mood === "sleepy") {
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
  const scale = mood === "oops" ? 1.08 : 1
  const { catchlight } = shapes
  return shapes.eyes.map((e) => (
    <G key={e.cx}>
      <Ellipse cx={e.cx} cy={e.cy} rx={e.rx * scale} ry={e.ry * scale} fill={palette.ink} />
      <Circle cx={e.cx + catchlight.dx} cy={e.cy + catchlight.dy} r={catchlight.r} fill={palette.white} />
    </G>
  ))
}

const Foot = ({ d }: { readonly d: string }) => (
  <Path d={d} stroke={palette.ink} strokeWidth={shapes.feet.width} strokeLinecap="round" />
)

/** What floats beside Kotori in some moods. It stays put while Kotori moves. */
const extras: Partial<Record<Mood, ReactNode>> = {
  oops: <Path d="M29 46 q 7 10 0 15 q -7 -5 0 -15 Z" fill={palette.sky} />,
  sleepy: (
    <SvgText x={25} y={38} fontSize={22} fontWeight="bold" fill={palette.sky}>
      z
    </SvgText>
  ),
  thinking: (
    <G opacity={0.85}>
      <Circle cx={40} cy={37} r={4} fill={palette.shade} />
      <Circle cx={29} cy={24} r={5.5} fill={palette.shade} />
      <Circle cx={15} cy={10} r={7.5} fill={palette.shade} />
    </G>
  ),
  celebrate: (
    <G fill={palette.blush}>
      <Path d="M158 9 l 3 8 l 8 3 l -8 3 l -3 8 l -3 -8 l -8 -3 l 8 -3 Z" />
      <Path d="M28 20 l 2 6 l 6 2 l -6 2 l -2 6 l -2 -6 l -6 -2 l 6 -2 Z" />
    </G>
  )
}

/** In these moods Kotori's eyes are open, so it blinks. */
const blinks = (mood: Mood) => mood === "curious" || mood === "thinking" || mood === "oops"

/** A clip and how far into it Kotori is. */
type Channel = { readonly clip: SharedValue<ClipName | null>; readonly time: SharedValue<number> }

const useChannel = (clip: ClipName | null, time: number): Channel => {
  const clipValue = useSharedValue(clip)
  const timeValue = useSharedValue(time)
  return useMemo(() => ({ clip: clipValue, time: timeValue }), [clipValue, timeValue])
}

/**
 * Plays a clip from the start, or skips to its last frame. The clock moves
 * first, so no frame shows the new clip at the old clip's time.
 */
const play = (channel: Channel, name: ClipName | null, animate: boolean) => {
  const duration = name === null ? 0 : clips[name].duration
  channel.time.set(animate ? 0 : duration)
  channel.clip.set(name)
  if (animate && name !== null) channel.time.set(withTiming(duration, { duration, easing: Easing.linear }))
}

/**
 * Moves the layer holding `part` to its pose in both channels at once. A
 * `shut` layer goes where `part` goes but shows as it fades, as shut eyes do.
 */
const usePartStyle = (part: Part, size: number, entrance: Channel, idle: Channel, shut = false) =>
  useAnimatedStyle(() => {
    const pose = combine(
      poseAt(entrance.clip.get(), part, entrance.time.get()),
      poseAt(idle.clip.get(), part, idle.time.get())
    )
    return { opacity: shut ? 1 - pose.opacity : pose.opacity, transform: viewTransform(pose, part, size) }
  })

/** A moving part on a canvas of its own, stacked over the parts drawn before it. */
const Layer = ({
  style,
  size,
  children
}: {
  readonly style: ComponentProps<typeof Animated.View>["style"]
  readonly size: number
  readonly children: ReactNode
}) => (
  <Animated.View style={[StyleSheet.absoluteFill, style]}>
    <Svg width={size} height={size} viewBox="0 0 200 200">
      {children}
    </Svg>
  </Animated.View>
)

/**
 * Kotori, the shima enaga. Changes expression with `mood`, plays the mood's
 * entrance from `motion.ts` and blinks now and then; with reduced motion it
 * holds each mood's pose and doesn't blink. Every moving part is a layer
 * placed with plain view transforms, so a clip plays the same way on iOS,
 * Android and the web.
 */
export const Mascot = ({ size = 120, mood = "curious" }: { readonly size?: number; readonly mood?: Mood }) => {
  const reduceMotion = useReducedMotion()
  const enter = entrances[mood] ?? null
  // Begin on the entrance's first frame, or on its last when it won't play.
  const entrance = useChannel(enter, reduceMotion && enter !== null ? clips[enter].duration : 0)
  const idle = useChannel(null, 0)

  useEffect(() => {
    play(entrance, enter, !reduceMotion)
  }, [entrance, enter, reduceMotion])

  useEffect(() => {
    if (reduceMotion || !blinks(mood)) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          play(idle, "blink", true)
          schedule()
        },
        2600 + Math.random() * 3200
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [idle, mood, reduceMotion])

  const bird = usePartStyle("bird", size, entrance, idle)
  const tail = usePartStyle("tail", size, entrance, idle)
  const backFoot = usePartStyle("backFoot", size, entrance, idle)
  const frontFoot = usePartStyle("frontFoot", size, entrance, idle)
  const wing = usePartStyle("wing", size, entrance, idle)
  const face = usePartStyle("face", size, entrance, idle)
  const eyes = usePartStyle("eyes", size, entrance, idle)
  const shutEyes = usePartStyle("eyes", size, entrance, idle, true)

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="image"
      accessibilityLabel="Kotori the long-tailed tit"
    >
      <Animated.View style={[StyleSheet.absoluteFill, bird]}>
        <Layer style={tail} size={size}>
          <Path d={shapes.tail} fill={palette.ink} />
        </Layer>
        <Layer style={backFoot} size={size}>
          <Foot d={shapes.feet.back} />
        </Layer>
        <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 200 200">
          {shapes.tuft.map((t) => (
            <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r} fill={palette.cream} />
          ))}
          <Path d={shapes.body} fill={palette.cream} />
          <Path d={shapes.shade} fill={palette.shade} />
          <Path d={shapes.belly} fill={palette.white} fillOpacity={0.4} />
        </Svg>
        <Layer style={frontFoot} size={size}>
          <Foot d={shapes.feet.front} />
        </Layer>
        <Layer style={wing} size={size}>
          <Path d={shapes.wing} fill={palette.ink} />
        </Layer>
        <Animated.View style={[StyleSheet.absoluteFill, face]}>
          <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 200 200">
            {shapes.cheeks.map((c) => (
              <Ellipse key={c.cx} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={palette.blush} />
            ))}
            <Path d={shapes.beak} fill={palette.ink} />
          </Svg>
          <Layer style={eyes} size={size}>
            <Eyes mood={mood} />
          </Layer>
          <Layer style={shutEyes} size={size}>
            <Eyes mood="sleepy" />
          </Layer>
        </Animated.View>
      </Animated.View>
      {extras[mood] === undefined ? null : (
        <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 200 200">
          {extras[mood]}
        </Svg>
      )}
    </View>
  )
}
