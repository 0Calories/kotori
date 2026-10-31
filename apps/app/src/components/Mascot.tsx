import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from "react"
import { StyleSheet, View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming
} from "react-native-reanimated"
import Svg, { Circle, Ellipse, G, Path, Text as SvgText } from "react-native-svg"
import { confetti, frontMoods, frontShapes, type Mood, palette, shapes, thinkingShapes } from "../mascot/geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  confettiFor,
  entrances,
  idles,
  loops,
  type Part,
  type Piece,
  pieceAt,
  pieceTransform,
  poseAt,
  type SparklePart,
  sparkleParts,
  sparklesFor,
  viewTransform
} from "../mascot/motion.ts"

export type { Mood }

/** The eyes and catchlight of one of Kotori's views. */
type Face = {
  readonly eyes: readonly { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }[]
  readonly catchlight: { readonly dx: number; readonly dy: number; readonly r: number }
}

const Eyes = ({ mood, face = shapes }: { readonly mood: Mood; readonly face?: Face }) => {
  if (mood === "happy" || mood === "celebrate") {
    return face.eyes.map((e) => (
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
    return face.eyes.map((e) => (
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
  const { catchlight } = face
  return face.eyes.map((e) => (
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
  )
}

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

/** Plays a clip over and over, `delay` ms from now; `null` stops it. */
const repeat = (channel: Channel, name: ClipName | null, delay: number) => {
  channel.time.set(0)
  channel.clip.set(name)
  if (name === null) return
  const { duration } = clips[name]
  channel.time.set(withDelay(delay, withRepeat(withTiming(duration, { duration, easing: Easing.linear }), -1)))
}

/** What Kotori is playing: the mood's entrance, then its loop over the entrance's last frame, and its idle clip over both. */
type Motion = { readonly entrance: Channel; readonly loop: Channel; readonly idle: Channel }

/**
 * Plays `mood`'s entrance and loop, and its idle clip now and then; with
 * reduced motion, holds the mood's pose and plays no idle. A view starts on the
 * entrance's first frame (or its last, when it won't play), so a view that
 * appears with the mood doesn't jump.
 */
const useMotion = (mood: Mood): Motion => {
  const reduceMotion = useReducedMotion()
  const enter = entrances[mood] ?? null
  const entrance = useChannel(enter, reduceMotion && enter !== null ? clips[enter].duration : 0)
  const loop = useChannel(null, 0)
  const idle = useChannel(null, 0)

  useEffect(() => {
    play(entrance, enter, !reduceMotion)
  }, [entrance, enter, reduceMotion])

  useEffect(() => {
    repeat(loop, reduceMotion ? null : (loops[mood] ?? null), enter === null ? 0 : clips[enter].duration)
    return () => cancelAnimation(loop.time)
  }, [loop, mood, enter, reduceMotion])

  const fidget = idles[mood] ?? null
  useEffect(() => {
    if (reduceMotion || fidget === null) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          play(idle, fidget, true)
          schedule()
        },
        2600 + Math.random() * 3200
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [idle, fidget, reduceMotion])

  return useMemo(() => ({ entrance, loop, idle }), [entrance, loop, idle])
}

/**
 * Moves the layer holding `part` to its pose in every channel at once, in a
 * canvas reaching `headroom` box units above the box. A `shut` layer goes
 * where `part` goes but shows as it fades, as shut eyes do.
 */
const usePartStyle = (part: Part, size: number, motion: Motion, shut = false, headroom = 0) =>
  useAnimatedStyle(() => {
    const { entrance, loop, idle } = motion
    const pose = combine(
      combine(poseAt(entrance.clip.get(), part, entrance.time.get()), poseAt(loop.clip.get(), part, loop.time.get())),
      poseAt(idle.clip.get(), part, idle.time.get())
    )
    return { opacity: shut ? 1 - pose.opacity : pose.opacity, transform: viewTransform(pose, part, size, headroom) }
  })

/** A canvas showing the 200×200 box at `size` pixels wide, and `headroom` units above it. */
const Canvas = ({
  size,
  headroom = 0,
  children
}: {
  readonly size: number
  readonly headroom?: number
  readonly children: ReactNode
}) => (
  <Svg
    style={StyleSheet.absoluteFill}
    width={size}
    height={(size * (200 + headroom)) / 200}
    viewBox={`0 ${-headroom} 200 ${200 + headroom}`}
  >
    {children}
  </Svg>
)

/** A moving part on a canvas of its own, stacked over the parts drawn before it. */
const Layer = ({
  style,
  size,
  headroom = 0,
  children
}: {
  readonly style: ComponentProps<typeof Animated.View>["style"]
  readonly size: number
  readonly headroom?: number
  readonly children: ReactNode
}) => (
  <Animated.View style={[StyleSheet.absoluteFill, style]}>
    <Svg width={size} height={(size * (200 + headroom)) / 200} viewBox={`0 ${-headroom} 200 ${200 + headroom}`}>
      {children}
    </Svg>
  </Animated.View>
)

/**
 * One of celebrate's sparkles, beside Kotori rather than on it, so it stays
 * put as Kotori moves. It comes out as celebrate's entrance plays, twinkles
 * as the idle clip says, and grows on a small Kotori (see `sparklesFor`).
 * Until the entrance starts, it shows as on its first frame: hidden.
 */
const Sparkle = ({
  part,
  size,
  entrance,
  idle
}: {
  readonly part: SparklePart
  readonly size: number
  readonly entrance: Channel
  readonly idle: Channel
}) => {
  const style = useAnimatedStyle(() => {
    const pose = combine(
      combine(
        poseAt("celebrate", part, entrance.clip.get() === "celebrate" ? entrance.time.get() : 0),
        poseAt(idle.clip.get(), part, idle.time.get())
      ),
      sparklesFor(size)
    )
    return { opacity: pose.opacity, transform: viewTransform(pose, part, size) }
  })
  return (
    <Layer style={style} size={size}>
      <Path d={shapes.sparkles[part]} fill={palette.blush} />
    </Layer>
  )
}

/** Piece `index` of the entrance's confetti, on a canvas of its own just big enough for it. */
const ConfettiPiece = ({
  piece,
  index,
  size,
  grow,
  entrance
}: {
  readonly piece: Piece
  readonly index: number
  readonly size: number
  readonly grow: number
  readonly entrance: Channel
}) => {
  const style = useAnimatedStyle(() => {
    const pose = pieceAt(entrance.clip.get(), index, entrance.time.get())
    return { opacity: pose.opacity, transform: pieceTransform(pose, size, grow) }
  })
  const { canvas } = confetti
  const width = (canvas * size * grow) / 200
  const bit = confetti.bits[piece.shape]
  const color = palette[piece.color]
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: 0, top: 0, width, height: width }, style]}
    >
      <Svg width={width} height={width} viewBox={`${-canvas / 2} ${-canvas / 2} ${canvas} ${canvas}`}>
        {bit.stroke === undefined ? (
          <Path d={bit.d} fill={color} />
        ) : (
          <Path d={bit.d} stroke={color} strokeWidth={bit.stroke} strokeLinecap="round" fill="none" />
        )}
      </Svg>
    </Animated.View>
  )
}

/**
 * The confetti Kotori throws as it plays `name`, behind it, with as many
 * pieces as suit its size. It's unmounted a second after the clip should
 * end: the UI thread starts the clip when it next draws, which can be late
 * on a busy screen, and the pieces hide themselves once they've fallen.
 */
const Confetti = ({
  name,
  size,
  entrance
}: {
  readonly name: ClipName
  readonly size: number
  readonly entrance: Channel
}) => {
  const [faded, setFaded] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setFaded(true), clips[name].duration + 1000)
    return () => clearTimeout(timer)
  }, [name])
  if (faded) return null
  const { count, grow } = confettiFor(size)
  return (clips[name].confetti?.pieces ?? [])
    .slice(0, count)
    .map((piece, index) => (
      <ConfettiPiece key={piece.to.join()} piece={piece} index={index} size={size} grow={grow} entrance={entrance} />
    ))
}

/** Kotori in three-quarter view. */
const Side = ({ size, mood }: { readonly size: number; readonly mood: Mood }) => {
  const reduceMotion = useReducedMotion()
  const enter = entrances[mood] ?? null
  const motion = useMotion(mood)
  const bird = usePartStyle("bird", size, motion)
  const tail = usePartStyle("tail", size, motion)
  const backFoot = usePartStyle("backFoot", size, motion)
  const frontFoot = usePartStyle("frontFoot", size, motion)
  const wing = usePartStyle("wing", size, motion)
  const face = usePartStyle("face", size, motion)
  const eyes = usePartStyle("eyes", size, motion)
  const shutEyes = usePartStyle("eyes", size, motion, true)

  return (
    <>
      {enter === null || clips[enter].confetti === undefined || reduceMotion ? null : (
        <Confetti key={enter} name={enter} size={size} entrance={motion.entrance} />
      )}
      <Animated.View style={[StyleSheet.absoluteFill, bird]}>
        <Layer style={tail} size={size}>
          <Path d={shapes.tail} fill={palette.ink} />
        </Layer>
        <Layer style={backFoot} size={size}>
          <Foot d={shapes.feet.back} />
        </Layer>
        <Canvas size={size}>
          {shapes.tuft.map((t) => (
            <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r} fill={palette.cream} />
          ))}
          <Path d={shapes.body} fill={palette.cream} />
          <Path d={shapes.shade} fill={palette.shade} />
          <Path d={shapes.belly} fill={palette.white} fillOpacity={0.4} />
        </Canvas>
        <Layer style={frontFoot} size={size}>
          <Foot d={shapes.feet.front} />
        </Layer>
        <Layer style={wing} size={size}>
          <Path d={shapes.wing} fill={palette.ink} />
        </Layer>
        <Animated.View style={[StyleSheet.absoluteFill, face]}>
          <Canvas size={size}>
            {shapes.cheeks.map((c) => (
              <Ellipse key={c.cx} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={palette.blush} />
            ))}
            <Path d={shapes.beak} fill={palette.ink} />
          </Canvas>
          <Layer style={eyes} size={size}>
            <Eyes mood={mood} />
          </Layer>
          <Layer style={shutEyes} size={size}>
            <Eyes mood="sleepy" />
          </Layer>
        </Animated.View>
      </Animated.View>
      {mood === "celebrate"
        ? sparkleParts.map((part) => (
            <Sparkle key={part} part={part} size={size} entrance={motion.entrance} idle={motion.idle} />
          ))
        : null}
      {extras[mood] === undefined ? null : <Canvas size={size}>{extras[mood]}</Canvas>}
    </>
  )
}

/**
 * The thought bubble, on a canvas that reaches above Kotori's box. It neither
 * takes up layout space nor catches touches, so it can overlap what's above.
 */
const ThoughtBubble = ({ size, motion }: { readonly size: number; readonly motion: Motion }) => {
  const { headroom, trail, dots } = thinkingShapes
  const bubble = usePartStyle("bubble", size, motion, false, headroom)
  const dot0 = usePartStyle("dot0", size, motion, false, headroom)
  const dot1 = usePartStyle("dot1", size, motion, false, headroom)
  const dot2 = usePartStyle("dot2", size, motion, false, headroom)
  const dotStyles = [dot0, dot1, dot2]
  const k = size / 200

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: -headroom * k,
        width: size,
        height: (200 + headroom) * k,
        pointerEvents: "none"
      }}
    >
      <Canvas size={size} headroom={headroom}>
        {trail.map((t) => (
          <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r} fill={palette.cream} />
        ))}
      </Canvas>
      <Animated.View style={[StyleSheet.absoluteFill, bubble]}>
        <Canvas size={size} headroom={headroom}>
          <Path d={thinkingShapes.bubble} fill={palette.cream} />
        </Canvas>
        {dots.map((d, i) => (
          <Layer key={d.cx} style={dotStyles[i]} size={size} headroom={headroom}>
            <Circle cx={d.cx} cy={d.cy} r={d.r} fill={palette.ink} />
          </Layer>
        ))}
      </Animated.View>
    </View>
  )
}

/**
 * Kotori facing the viewer: thinking, in a still pose with a wing raised to
 * its chin. Only the thought bubble above its head moves.
 */
const Front = ({ size, mood }: { readonly size: number; readonly mood: Mood }) => {
  const motion = useMotion(mood)
  const { feet, wings } = frontShapes

  return (
    <>
      <Canvas size={size}>
        <Path d={wings[1]} fill={palette.ink} />
        {frontShapes.tuft.map((t) => (
          <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r} fill={palette.cream} />
        ))}
        <Path d={frontShapes.body} fill={palette.cream} />
        <Path d={frontShapes.shade} fill={palette.shade} />
        <Path d={frontShapes.belly} fill={palette.white} fillOpacity={0.4} />
        {[feet.left, feet.right].map((d) => (
          <Path key={d} d={d} stroke={palette.ink} strokeWidth={feet.width} strokeLinecap="round" />
        ))}
        {frontShapes.cheeks.map((c) => (
          <Ellipse key={c.cx} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={palette.blush} />
        ))}
        <Eyes mood={mood} face={frontShapes} />
        <Path d={frontShapes.beak} fill={palette.ink} />
        <Path d={thinkingShapes.chinWing} fill={palette.ink} />
      </Canvas>
      <ThoughtBubble size={size} motion={motion} />
    </>
  )
}

/**
 * Kotori, the shima enaga. Changes expression with `mood`, plays the mood's
 * entrance and loop from `motion.ts`, confetti and all, and now and then
 * blinks or twinkles its sparkles; with reduced motion it holds each mood's
 * pose, and doesn't blink, twinkle or throw confetti. Thinking, it faces the
 * viewer and holds still under a thought bubble that rises above its `size`
 * box. Every moving part is a layer placed with plain view transforms, so a
 * clip plays the same way on iOS, Android and the web.
 */
export const Mascot = ({ size = 120, mood = "curious" }: { readonly size?: number; readonly mood?: Mood }) => (
  <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel="Kotori the long-tailed tit">
    {frontMoods.has(mood) ? <Front size={size} mood={mood} /> : <Side size={size} mood={mood} />}
  </View>
)
