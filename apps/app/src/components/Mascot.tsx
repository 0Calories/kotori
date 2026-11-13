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
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg"
import {
  catchlightDx,
  confetti,
  type Facing,
  frontMoods,
  frontShapes,
  type Mood,
  palette,
  puffPath,
  readingShapes,
  shapes,
  sparklePath,
  thinkingShapes,
  trailPath
} from "../mascot/geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  confettiFor,
  entrances,
  idles,
  type LandingPart,
  loops,
  type Part,
  type Piece,
  pieceAt,
  pieceTransform,
  poseAt,
  puffParts,
  type SparklePart,
  sparkleParts,
  type SparkPart,
  sparkParts,
  sparklesFor,
  trailParts,
  viewTransform,
  type ZPart,
  zParts
} from "../mascot/motion.ts"

export type { Facing, Mood }

/** The eyes and catchlight of one of Kotori's views. */
type Face = {
  readonly eyes: readonly { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }[]
  /** `inward` mirrors `dx` on the eye right of the middle, so both catch the light on the beak's side. */
  readonly catchlight: { readonly dx: number; readonly dy: number; readonly r: number; readonly inward?: boolean }
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
      <Circle
        cx={e.cx + catchlightDx(catchlight, e.cx)}
        cy={e.cy + catchlight.dy}
        r={catchlight.r}
        fill={palette.white}
      />
    </G>
  ))
}

const Foot = ({ d }: { readonly d: string }) => (
  <Path d={d} stroke={palette.ink} strokeWidth={shapes.feet.width} strokeLinecap="round" />
)

/** What floats beside Kotori in some moods in three-quarter view. It stays put while Kotori moves. */
const sideExtras: Partial<Record<Mood, ReactNode>> = {
  oops: <Path d={shapes.sweat} fill={palette.sky} />
}

/** What shows on or beside Kotori in some moods in the front view. */
const frontExtras: Partial<Record<Mood, ReactNode>> = {
  oops: <Path d={frontShapes.sweat} fill={palette.sky} />
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
 * put as Kotori moves. It glints once as celebrate's entrance ends, grown on a
 * small Kotori (see `sparklesFor`), and is hidden before and after.
 */
const Sparkle = ({
  part,
  size,
  entrance
}: {
  readonly part: SparklePart
  readonly size: number
  readonly entrance: Channel
}) => {
  const style = useAnimatedStyle(() => {
    const pose = combine(
      poseAt("celebrate", part, entrance.clip.get() === "celebrate" ? entrance.time.get() : 0),
      sparklesFor(size)
    )
    return { opacity: pose.opacity, transform: viewTransform(pose, part, size) }
  })
  return (
    <Layer style={style} size={size}>
      <Path d={sparklePath(shapes.sparkles[part])} fill={palette.gold} />
    </Layer>
  )
}

/**
 * One of sleepy's Zs, floating up and fading out from Kotori's brow on a loop
 * (or holding its drawn place with reduced motion). When `Side` mirrors the
 * view for `facing === "right"`, `flip` mirrors the Z back about its own
 * centre so the letter still reads forwards.
 */
const SleepyZ = ({
  part,
  size,
  loop,
  reduceMotion,
  flip = false
}: {
  readonly part: ZPart
  readonly size: number
  readonly loop: Channel
  readonly reduceMotion: boolean
  readonly flip?: boolean
}) => {
  const style = useAnimatedStyle(() => {
    const pose = poseAt(reduceMotion ? null : "sleepy", part, loop.clip.get() === "sleepy" ? loop.time.get() : 0)
    const oriented = flip ? { ...pose, scaleX: -pose.scaleX } : pose
    return { opacity: oriented.opacity, transform: viewTransform(oriented, part, size) }
  })
  const { d, stroke } = shapes.zs[part]
  return (
    <Layer style={style} size={size}>
      <Path d={d} stroke={palette.sky} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

/** Kotori in three-quarter view. `facing === "right"` mirrors the side view angle. */
const Side = ({
  size,
  mood,
  facing = "left"
}: {
  readonly size: number
  readonly mood: Mood
  readonly facing?: "left" | "right"
}) => {
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
    <View style={[StyleSheet.absoluteFill, facing === "right" ? { transform: [{ scaleX: -1 }] } : null]}>
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
        ? sparkleParts.map((part) => <Sparkle key={part} part={part} size={size} entrance={motion.entrance} />)
        : null}
      {mood === "sleepy"
        ? zParts.map((part) => (
            <SleepyZ
              key={part}
              part={part}
              size={size}
              loop={motion.loop}
              reduceMotion={reduceMotion}
              flip={facing === "right"}
            />
          ))
        : null}
      {sideExtras[mood] === undefined ? null : <Canvas size={size}>{sideExtras[mood]}</Canvas>}
    </View>
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
 * Kotori facing the viewer. It holds its pose while blinking in open-eyed
 * moods; `thinking` raises its left wing to its chin under the moving thought
 * bubble above its head.
 */
const Front = ({ size, mood }: { readonly size: number; readonly mood: Mood }) => {
  const reduceMotion = useReducedMotion()
  const motion = useMotion(mood)
  const eyes = usePartStyle("eyes", size, motion)
  const shutEyes = usePartStyle("eyes", size, motion, true)
  const { feet, wings } = frontShapes
  const thinking = mood === "thinking"

  return (
    <>
      <Canvas size={size}>
        <Path d={wings[1]} fill={palette.ink} />
        {thinking ? null : <Path d={wings[0]} fill={palette.ink} />}
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
        <Path d={frontShapes.beak} fill={palette.ink} />
        {thinking ? <Path d={thinkingShapes.chinWing} fill={palette.ink} /> : null}
        {frontExtras[mood]}
      </Canvas>
      <Layer style={eyes} size={size}>
        <Eyes mood={mood} face={frontShapes} />
      </Layer>
      <Layer style={shutEyes} size={size}>
        <Eyes mood="sleepy" face={frontShapes} />
      </Layer>
      {mood === "sleepy"
        ? zParts.map((part) => (
            <SleepyZ key={part} part={part} size={size} loop={motion.loop} reduceMotion={reduceMotion} />
          ))
        : null}
      {thinking ? <ThoughtBubble size={size} motion={motion} /> : null}
    </>
  )
}

/** A page of Kotori's dictionary, its far edge and its print. */
const Page = ({ side }: { readonly side: 0 | 1 }) => {
  const { book } = readingShapes
  return (
    <>
      <Path d={book.pages[side]} fill={palette.paper} />
      <Path d={book.edges[side]} stroke={palette.shade} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <Path
        d={book.print[side]}
        stroke={palette.ink}
        strokeOpacity={0.45}
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
    </>
  )
}

/**
 * A puff of dust, a spark or a spark's trail that the dictionary throws up
 * as it lands, from the foot of its spine, a spark and its trail in the
 * spark's `color`. It shows only as the book takes its place, grown on a
 * small Kotori as celebrate's sparkles are (see `sparklesFor`).
 */
const Landing = ({
  part,
  size,
  entrance,
  color = palette.white
}: {
  readonly part: LandingPart
  readonly size: number
  readonly entrance: Channel
  readonly color?: string
}) => {
  const style = useAnimatedStyle(() => {
    const pose = combine(poseAt(entrance.clip.get(), part, entrance.time.get()), sparklesFor(size))
    return { opacity: pose.opacity, transform: viewTransform(pose, part, size) }
  })
  const { origin, puff, sparks } = readingShapes.landing
  return (
    <Layer style={style} size={size}>
      {part === "puff0" || part === "puff1" ? (
        <Path
          d={puffPath({ cx: origin.x, cy: origin.y, r: puff })}
          fill={palette.white}
          stroke={palette.paperLine}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ) : part in sparks ? (
        <Path d={sparklePath({ cx: origin.x, cy: origin.y, r: sparks[part as SparkPart].r })} fill={color} />
      ) : (
        <Path d={trailPath(origin)} fill={color} fillOpacity={0.6} />
      )}
    </Layer>
  )
}

/** A wing as Kotori holds it, in ink. */
const Wing = ({ d }: { readonly d: string }) => <Path d={d} fill={palette.ink} />

/**
 * Kotori reading, facing the viewer in round glasses over an open dictionary.
 * Taking up the book, it puts its glasses on and the book drops in front of
 * it (see `startReading`), puffing out dust from under its spine as sparks
 * fly out from there; then its eyes run along the lines and now and then
 * blink, and its left wing turns the pages. Every part that moves as it does
 * is a layer of its own, the page it turns and that wing over the book and
 * under the other wing, the dust behind the spine and the sparks over it all.
 */
const Reading = ({ size }: { readonly size: number }) => {
  const motion = useMotion("reading")
  const foldedWing0 = usePartStyle("foldedWing0", size, motion)
  const foldedWing1 = usePartStyle("foldedWing1", size, motion)
  const cheeks = usePartStyle("cheeks", size, motion)
  const eyes = usePartStyle("eyes", size, motion)
  const shutEyes = usePartStyle("eyes", size, motion, true)
  const lookingEyes = usePartStyle("lookingEyes", size, motion)
  const glassesStyle = usePartStyle("glasses", size, motion)
  const bookStyle = usePartStyle("book", size, motion)
  const spineStyle = usePartStyle("book", size, motion)
  const page = usePartStyle("page", size, motion)
  const pageWing = usePartStyle("pageWing", size, motion)
  const bookWing = usePartStyle("bookWing", size, motion)
  const { glasses, book, wings } = readingShapes
  const { feet } = frontShapes

  return (
    <>
      <Layer style={foldedWing1} size={size}>
        <Wing d={frontShapes.wings[1]} />
      </Layer>
      <Layer style={foldedWing0} size={size}>
        <Wing d={frontShapes.wings[0]} />
      </Layer>
      <Canvas size={size}>
        {frontShapes.tuft.map((t) => (
          <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r} fill={palette.cream} />
        ))}
        <Path d={frontShapes.body} fill={palette.cream} />
        <Path d={frontShapes.shade} fill={palette.shade} />
        <Path d={frontShapes.belly} fill={palette.white} fillOpacity={0.4} />
        {[feet.left, feet.right].map((d) => (
          <Path key={d} d={d} stroke={palette.ink} strokeWidth={feet.width} strokeLinecap="round" />
        ))}
        <Path d={frontShapes.beak} fill={palette.ink} />
      </Canvas>
      <Layer style={cheeks} size={size}>
        {readingShapes.cheeks.map((c) => (
          <Ellipse key={c.cx} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={palette.blush} />
        ))}
      </Layer>
      <Layer style={eyes} size={size}>
        <Eyes mood="reading" face={readingShapes} />
      </Layer>
      <Layer style={shutEyes} size={size}>
        <Eyes mood="sleepy" face={readingShapes} />
      </Layer>
      <Layer style={lookingEyes} size={size}>
        <Eyes mood="neutral" face={frontShapes} />
      </Layer>
      <Layer style={glassesStyle} size={size}>
        {glasses.lenses.map((l) => (
          <Circle
            key={l.cx}
            cx={l.cx}
            cy={l.cy}
            r={l.r}
            stroke={palette.frame}
            strokeWidth={glasses.stroke}
            fill="none"
          />
        ))}
        <Path
          d={glasses.bridge}
          stroke={palette.frame}
          strokeWidth={glasses.stroke}
          strokeLinecap="round"
          fill="none"
        />
      </Layer>
      <Layer style={bookStyle} size={size}>
        <Path d={book.coverTop} fill={palette.leatherDark} />
        {book.stacks.map((d) => (
          <Path key={d} d={d} fill={palette.paperEdge} />
        ))}
        <Path d={book.stackLines} stroke={palette.paperLine} strokeWidth={1.8} strokeLinecap="round" fill="none" />
        <Path d={book.coverEdge} fill={palette.leather} />
        <Page side={0} />
        <Page side={1} />
        <Path d={book.gutter} stroke={palette.shade} strokeWidth={2.6} fill="none" />
      </Layer>
      <Layer style={page} size={size}>
        <Page side={0} />
      </Layer>
      <Layer style={pageWing} size={size}>
        <Wing d={wings[0]} />
      </Layer>
      <Layer style={bookWing} size={size}>
        <Wing d={wings[1]} />
      </Layer>
      {puffParts.map((part) => (
        <Landing key={part} part={part} size={size} entrance={motion.entrance} />
      ))}
      <Layer style={spineStyle} size={size}>
        <Path d={book.spine} fill={palette.leather} />
        <Path d={book.spineHollow} fill={palette.leatherDark} />
      </Layer>
      {sparkParts.map((spark, i) => (
        <Landing
          key={trailParts[i]}
          part={trailParts[i] ?? spark}
          size={size}
          entrance={motion.entrance}
          color={palette[readingShapes.landing.sparks[spark].color]}
        />
      ))}
      {sparkParts.map((spark) => (
        <Landing
          key={spark}
          part={spark}
          size={size}
          entrance={motion.entrance}
          color={palette[readingShapes.landing.sparks[spark].color]}
        />
      ))}
    </>
  )
}

/**
 * Kotori, the shima enaga. Changes expression with `mood` and angle with
 * `facing`, plays the mood's entrance and loop from `motion.ts`, confetti and
 * all, and now and then blinks; with reduced motion it holds each mood's pose,
 * and doesn't blink, throw confetti or glint.
 * Thinking, it faces the viewer and holds still under a thought bubble that
 * rises above its `size` box. Reading, it faces the viewer: it puts on its
 * glasses and a dictionary drops open in front of it, then its eyes run along
 * the lines as its wing turns the pages.
 *
 * Kotori reads whenever it is fetching, looking up or writing something for
 * the learner: a slow dictionary search, a screen loading its content (after
 * `useReadingPhase`'s delay), example sentences being written, and the first
 * part of an ask. It thinks when working something out, as an ask runs on,
 * and over a verdict that needs a second look.
 *
 * Every moving part is a layer placed with plain view transforms, so a clip
 * plays the same way on iOS, Android and the web.
 */
export const Mascot = ({
  size = 120,
  mood = "neutral",
  facing = "left"
}: {
  readonly size?: number
  readonly mood?: Mood
  readonly facing?: Facing
}) => (
  <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel="Kotori the long-tailed tit">
    {mood === "reading" ? (
      <Reading size={size} />
    ) : facing === "front" || frontMoods.has(mood) ? (
      <Front size={size} mood={mood} />
    ) : (
      <Side size={size} mood={mood} facing={facing} />
    )}
  </View>
)
