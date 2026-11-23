import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
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
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets"
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
  trailPath,
  writingShapes
} from "../mascot/geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  confettiFor,
  entrances,
  idles,
  inkParts,
  type LandingPart,
  loops,
  moveBetween,
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
  unwrittenParts,
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
 * Plays a clip from the start, or skips to its last frame, and calls `done`
 * on the UI thread once it has played to the end. The clock moves first, so
 * no frame shows the new clip at the old clip's time.
 */
const play = (channel: Channel, name: ClipName | null, animate: boolean, done?: () => void) => {
  "worklet"
  const duration = name === null ? 0 : clips[name].duration
  channel.time.set(animate ? 0 : duration)
  channel.clip.set(name)
  if (animate && name !== null) {
    channel.time.set(
      withTiming(duration, { duration, easing: Easing.linear }, (finished) => {
        if (finished === true && done !== undefined) done()
      })
    )
  }
}

/** Plays a clip over and over, `delay` ms from now; `null` stops it. */
const repeat = (channel: Channel, name: ClipName | null, delay: number) => {
  "worklet"
  channel.time.set(0)
  channel.clip.set(name)
  if (name === null) return
  const duration = clips[name].duration
  channel.time.set(withDelay(delay, withRepeat(withTiming(duration, { duration, easing: Easing.linear }), -1)))
}

/** What Kotori is playing: the mood's entrance, then its loop over the entrance's last frame, and its idle clip over both. */
type Motion = { readonly entrance: Channel; readonly loop: Channel; readonly idle: Channel }

/**
 * Plays `channel`'s clip on from where it is to its end, `length`, and calls
 * `then` on the UI thread as it gets there. What was playing is stopped
 * first: a new timing to the same end would otherwise take on the old one's
 * start, and get there early.
 */
const playOn = (channel: Channel, length: number, then: () => void) => {
  "worklet"
  cancelAnimation(channel.time)
  const at = channel.time.get()
  channel.time.set(
    withTiming(length, { duration: length - at, easing: Easing.linear }, (finished) => {
      if (finished === true) then()
    })
  )
}

/**
 * Calls `then` on the UI thread the moment Kotori is next on its mood's
 * drawing: as its entrance ends, if that's still playing, or else as its loop
 * comes round. Whatever's playing carries on until then, and the loop stops
 * there; a loop yet to start never does. Called again before then, it takes
 * over: only the latest `then` is called.
 */
const onceOnDrawing = (motion: Motion, then: () => void) => {
  "worklet"
  const entrance = motion.entrance
  const loop = motion.loop
  const entering = entrance.clip.get()
  const length = entering === null ? 0 : clips[entering].duration
  if (entrance.time.get() < length) {
    cancelAnimation(loop.time)
    loop.time.set(0)
    loop.clip.set(null)
    playOn(entrance, length, then)
    return
  }
  const looping = loop.clip.get()
  if (looping === null) {
    then()
    return
  }
  playOn(loop, clips[looping].duration, () => {
    "worklet"
    loop.time.set(0)
    loop.clip.set(null)
    then()
  })
}

/** Takes a mood once Kotori is on the drawing of the one before: its entrance from there, then its loop. */
const carryOn = (motion: Motion, entrance: ClipName | null, loop: ClipName | null) => {
  "worklet"
  onceOnDrawing(motion, () => {
    "worklet"
    play(motion.entrance, entrance, true)
    repeat(motion.loop, loop, entrance === null ? 0 : clips[entrance].duration)
  })
}

/**
 * Plays Kotori out of its mood with `clip` once it's on the mood's drawing,
 * and calls `done` on the JS thread as that ends. If it hasn't yet started
 * the mood's entrance, `entered`, it's still carrying on from the mood before
 * (see `carryOn`): it takes that over, and plays the entrance before `clip`,
 * so the mood it's leaving shows before it goes. If it's already playing
 * `clip`, that will call `done`.
 */
const playOut = (motion: Motion, entered: ClipName | null, clip: ClipName, done: () => void) => {
  "worklet"
  const playing = motion.entrance.clip.get()
  if (playing === clip) return
  const leave = () => {
    "worklet"
    play(motion.entrance, clip, true, () => {
      "worklet"
      scheduleOnRN(done)
    })
  }
  if (playing === entered) {
    onceOnDrawing(motion, leave)
    return
  }
  if (entered === null) {
    scheduleOnRN(done)
    return
  }
  onceOnDrawing(motion, () => {
    "worklet"
    play(motion.entrance, entered, true, leave)
  })
}

/** How Kotori leaves the mood it's in for the one asked for: the clip it plays out of it, and what's to happen once that ends. */
type Leaving = { readonly clip: ClipName; readonly done: () => void }

/** Set by `Mascot` when the screen asks Kotori to keep `still`. */
const StillContext = createContext(false)

/** Whether Kotori holds its pose: the user prefers reduced motion, or the screen asked it to keep still. */
const useStill = () => {
  const reduceMotion = useReducedMotion()
  const still = useContext(StillContext)
  return reduceMotion || still
}

/**
 * Plays `mood`'s entrance and loop, and its idle clip now and then; with
 * reduced motion, holds the mood's pose and plays no idle. A view starts on the
 * entrance's first frame (or its last, when it won't play), so a view that
 * appears with the mood doesn't jump. Going on from a mood the same view shows
 * by one of `moves`, it lets that mood's loop come round first, as the new
 * entrance starts from its drawing; `leaving`, it plays the move's clip out
 * of the mood once its loop comes round.
 */
const useMotion = (mood: Mood, leaving: Leaving | null = null): Motion => {
  const reduceMotion = useStill()
  const enter = entrances[mood] ?? null
  const entrance = useChannel(enter, reduceMotion && enter !== null ? clips[enter].duration : 0)
  const loop = useChannel(null, 0)
  const idle = useChannel(null, 0)
  const motion = useMemo(() => ({ entrance, loop, idle }), [entrance, loop, idle])
  // The mood the channels last took, for telling a move from a plain change.
  const taken = useRef<Mood | null>(null)

  useEffect(() => {
    const from = taken.current
    taken.current = mood
    const after = reduceMotion ? null : (loops[mood] ?? null)
    if (!reduceMotion && from !== null && from !== mood && moveBetween(from, mood) !== undefined) {
      scheduleOnUI(carryOn, motion, enter, after)
      return
    }
    play(entrance, enter, !reduceMotion)
    repeat(loop, after, enter === null ? 0 : clips[enter].duration)
  }, [motion, entrance, loop, mood, enter, reduceMotion])

  const leavingClip = leaving?.clip ?? null
  const leavingDone = leaving?.done ?? null
  useEffect(() => {
    if (leavingClip === null || leavingDone === null) return
    if (reduceMotion) leavingDone()
    else scheduleOnUI(playOut, motion, enter, leavingClip, leavingDone)
  }, [motion, enter, leavingClip, leavingDone, reduceMotion])

  // Stop whatever's running once the view is gone.
  useEffect(
    () => () => {
      cancelAnimation(entrance.time)
      cancelAnimation(loop.time)
    },
    [entrance, loop]
  )

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

  return motion
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
  const reduceMotion = useStill()
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
  const reduceMotion = useStill()
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

/** A page of Kotori's dictionary and its far edge, with its print unless it's `blank`. */
const Page = ({ side, blank = false }: { readonly side: 0 | 1; readonly blank?: boolean }) => {
  const { book } = readingShapes
  return (
    <>
      <Path d={book.pages[side]} fill={palette.paper} />
      <Path d={book.edges[side]} stroke={palette.shade} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      {blank ? null : (
        <Path d={book.print[side]} stroke={palette.print} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      )}
    </>
  )
}

/** The crease down the dictionary's spine. */
const Gutter = () => <Path d={readingShapes.book.gutter} stroke={palette.shade} strokeWidth={2.6} fill="none" />

/** Kotori's quill: the bare quill and its nib, the feather, and the shaft down it. */
const Quill = () => {
  const { barrel, point, vane, shaft, shaftWidth } = writingShapes.quill
  return (
    <>
      <Path d={barrel} fill={palette.quill} />
      <Path d={point} fill={palette.ink} />
      <Path d={vane} fill={palette.quill} />
      <Path d={shaft} stroke={palette.quillShaft} strokeWidth={shaftWidth} strokeLinecap="round" fill="none" />
    </>
  )
}

/** A stroke of Kotori's handwriting. */
const Ink = ({ d, stroke }: { readonly d: string; readonly stroke: number }) => (
  <Path d={d} stroke={palette.print} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill="none" />
)

/** Half of the dictionary, either side of its spine: the back cover's top and edge, the stacked pages and the page over them. */
const BookHalf = ({ side }: { readonly side: 0 | 1 }) => {
  const { book } = readingShapes
  return (
    <>
      <Path d={book.coverTop[side]} fill={palette.leatherDark} />
      <Path d={book.stacks[side]} fill={palette.paperEdge} />
      <Path d={book.stackLines[side]} stroke={palette.paperLine} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d={book.coverEdge[side]} fill={palette.leather} />
      <Page side={side} />
    </>
  )
}

/**
 * The back of the dictionary's left half, which shows as it closes over the
 * right: the book shut, drawn mirrored on the left, so that as the half turns
 * over the spine and lands, the shut book lies where the right half was.
 */
const BookBack = () => {
  const { coverEdge, closed } = readingShapes.book
  return (
    <G transform="matrix(-1 0 0 1 200 0)">
      <Path d={coverEdge[1]} fill={palette.leather} />
      <Path d={closed.pages} fill={palette.paperEdge} />
      <Path d={closed.pageLines} stroke={palette.paperLine} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      <Path d={closed.coverEdge} fill={palette.leatherDark} />
      <Path
        d={closed.cover}
        fill={palette.leather}
        stroke={palette.leatherDark}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d={closed.band} fill={palette.gold} />
      <Path
        d={closed.spine}
        fill={palette.leather}
        stroke={palette.leatherDark}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </G>
  )
}

/** A part of Kotori that moves through `motion`, on a layer of its own. */
const Moving = ({
  part,
  size,
  motion,
  children
}: {
  readonly part: Part
  readonly size: number
  readonly motion: Motion
  readonly children: ReactNode
}) => {
  const style = usePartStyle(part, size, motion)
  return (
    <Layer style={style} size={size}>
      {children}
    </Layer>
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
 * Kotori at its dictionary, facing the viewer in round glasses over the open
 * book, reading or writing. Taking up the book, it puts its glasses on and
 * the book drops in front of it (see `startReading`), puffing out dust from
 * under its spine as sparks fly out from there; then its eyes run along the
 * lines and now and then blink, and its left wing turns the pages. Taking up
 * its quill from there (see `startWriting`), it turns to a fresh page and
 * writes an entry out, the quill in its right wing, page after page; leaving
 * to celebrate, it puts the quill away, closes the book and takes its
 * glasses off first (see `finishWriting`).
 * Every part that moves as it does is a layer of its own: the page it turns
 * and that wing over the book and under the other wing, what Kotori writes
 * on the fresh page under the page it turns, the quill in the wing that
 * holds it, the dust behind the spine and the sparks over it all; and the
 * book's left half, under the page it turns, and that half's back, over all
 * Kotori writes, so it can close the book. The quill, all it writes and the
 * book's back are there only while Kotori writes.
 */
const Book = ({
  size,
  mood,
  leaving
}: {
  readonly size: number
  readonly mood: "reading" | "writing"
  readonly leaving: Leaving | null
}) => {
  const motion = useMotion(mood, leaving)
  const writing = mood === "writing"
  const foldedWing0 = usePartStyle("foldedWing0", size, motion)
  const foldedWing1 = usePartStyle("foldedWing1", size, motion)
  const cheeks = usePartStyle("cheeks", size, motion)
  const eyes = usePartStyle("eyes", size, motion)
  const shutEyes = usePartStyle("eyes", size, motion, true)
  const lookingEyes = usePartStyle("lookingEyes", size, motion)
  const glassesStyle = usePartStyle("glasses", size, motion)
  const bookStyle = usePartStyle("book", size, motion)
  const bookLeft = usePartStyle("bookLeft", size, motion)
  const spineStyle = usePartStyle("spine", size, motion)
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
      <Layer style={bookLeft} size={size}>
        <BookHalf side={0} />
      </Layer>
      <Layer style={bookStyle} size={size}>
        <BookHalf side={1} />
        <Gutter />
      </Layer>
      {writing ? (
        <>
          <Moving part="freshPage" size={size} motion={motion}>
            <Page side={1} blank />
            <Gutter />
          </Moving>
          {inkParts.map((part) => (
            <Moving key={part} part={part} size={size} motion={motion}>
              <Ink {...writingShapes.words[part]} />
            </Moving>
          ))}
          {unwrittenParts.map((part) => (
            <Moving key={part} part={part} size={size} motion={motion}>
              <Path d={writingShapes.slip.d} fill={palette.paper} />
            </Moving>
          ))}
          <Moving part="leaf" size={size} motion={motion}>
            <Page side={0} blank />
          </Moving>
        </>
      ) : null}
      <Layer style={page} size={size}>
        <Page side={0} />
      </Layer>
      {writing ? (
        <Moving part="bookBack" size={size} motion={motion}>
          <BookBack />
        </Moving>
      ) : null}
      <Layer style={pageWing} size={size}>
        <Wing d={wings[0]} />
      </Layer>
      {/* The quill moves with the wing that holds it, and sways about its nib besides. */}
      <Animated.View style={[StyleSheet.absoluteFill, bookWing]}>
        <Canvas size={size}>
          <Wing d={wings[1]} />
        </Canvas>
        {writing ? (
          <Moving part="quill" size={size} motion={motion}>
            <Quill />
          </Moving>
        ) : null}
      </Animated.View>
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
 * The mood and facing Kotori shows: the ones asked for, except while it plays
 * its way out of the mood it's in with a move's clip (see `moves`), when it
 * holds on to that mood, in its own view, until the clip has played. Holding
 * still, it takes each mood at once.
 */
const useShown = (mood: Mood, facing: Facing, still: boolean) => {
  const [shown, setShown] = useState({ mood, facing })
  // Whether Kotori has played its way out of the mood it shows.
  const [out, setOut] = useState(false)
  const clip = moveBetween(shown.mood, mood)?.clip
  const leaving = !still && !out && shown.mood !== mood && clip !== undefined
  if (!leaving && (shown.mood !== mood || shown.facing !== facing)) {
    setShown({ mood, facing })
    setOut(false)
  }
  // Asked to stay after all: the next move out plays in full.
  if (out && shown.mood === mood) setOut(false)
  const done = useCallback(() => setOut(true), [])
  return leaving ? { ...shown, leaving: { clip, done } } : { mood, facing, leaving: null }
}

/**
 * Kotori, the shima enaga. Changes expression with `mood` and angle with
 * `facing`, plays the mood's entrance and loop from `motion.ts`, confetti and
 * all, and now and then blinks; with reduced motion it holds each mood's pose,
 * and doesn't blink, throw confetti or glint. Some changes of mood it plays
 * out rather than cutting to the new one (see `moves`).
 * Thinking, it faces the viewer and holds still under a thought bubble that
 * rises above its `size` box. Reading, it faces the viewer: it puts on its
 * glasses and a dictionary drops open in front of it, then its eyes run along
 * the lines as its wing turns the pages. Writing, it goes on from there: it
 * turns to a fresh page, takes up its quill and writes an entry out, page
 * after page, and closes the book and takes its glasses off before it celebrates.
 *
 * Kotori reads whenever it is fetching, looking up or writing something for
 * the learner: a slow dictionary search, example sentences being written, and
 * the first part of an ask. It writes as an ask runs on, drafting an entry for
 * the dictionary, and celebrates once a fresh one comes. It thinks when
 * working something out, and over a verdict that needs a second look.
 *
 * `still` holds every mood's pose as reduced motion does, for a place where
 * movement would distract, such as the search field while a search runs.
 *
 * Every moving part is a layer placed with plain view transforms, so a clip
 * plays the same way on iOS, Android and the web.
 */
export const Mascot = ({
  size = 120,
  mood = "neutral",
  facing = "left",
  still = false
}: {
  readonly size?: number
  readonly mood?: Mood
  readonly facing?: Facing
  readonly still?: boolean
}) => {
  const reduceMotion = useReducedMotion()
  const shown = useShown(mood, facing, still || reduceMotion)
  return (
    <StillContext value={still}>
      <View
        style={{ width: size, height: size }}
        accessibilityRole="image"
        accessibilityLabel="Kotori the long-tailed tit"
      >
        {shown.mood === "reading" || shown.mood === "writing" ? (
          <Book size={size} mood={shown.mood} leaving={shown.leaving} />
        ) : shown.facing === "front" || frontMoods.has(shown.mood) ? (
          <Front size={size} mood={shown.mood} />
        ) : (
          <Side size={size} mood={shown.mood} facing={shown.facing} />
        )}
      </View>
    </StillContext>
  )
}
