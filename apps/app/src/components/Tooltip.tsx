import { usePathname } from "expo-router"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react"
import { Dimensions, Platform, StyleSheet, View } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { type Box, placeTooltip, type Size, TOOLTIP_MARGIN } from "../lib/tooltip.ts"
import { easeOut } from "../theme/easing.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

const WEB = Platform.OS === "web"

/** How long the pointer rests on a trigger before its tooltip opens. */
const HOVER_DELAY_MS = 120
/** Leaving a trigger waits this long to close, so moving on to its neighbour swaps the text instead of blinking. */
const HOVER_GRACE_MS = 80
/** After a tooltip closes, the next one opens without the delay for this long. */
const WARM_MS = 400
const MAX_WIDTH = 272
const ARROW = 12

interface Tip {
  readonly id: string
  readonly text: string
  /** A fainter line under the text. */
  readonly note?: string
  /** The trigger, in window coordinates. */
  readonly anchor: Box
  /** The trigger's DOM node on the web, so a press on it isn't taken for a press outside. */
  readonly node: unknown
}

interface Tooltips {
  /** The id of the open tooltip. */
  readonly open: string | null
  readonly show: (tip: Tip) => void
  /** Closes the tooltip with this id, if it is the open one. */
  readonly hide: (id: string, delay?: number) => void
  /** Whether a tooltip is open or just closed, so the next opens at once. */
  readonly warm: () => boolean
  /** Closes whichever tooltip is open. */
  readonly close: () => void
  /** On native, marks a touch as landing on this trigger, so it isn't taken for a touch elsewhere. */
  readonly claim: (id: string) => void
}

const TooltipContext = createContext<Tooltips>({
  open: null,
  show: () => {},
  hide: () => {},
  warm: () => false,
  close: () => {},
  claim: () => {}
})

/** While a tooltip is open, what closes it: for a scroll view, whose content moves out from under it. */
export const useCloseOpenTooltip = () => {
  const { open, close } = useContext(TooltipContext)
  return open === null ? null : close
}

const Bubble = ({ tip, layer }: { readonly tip: Tip; readonly layer: Box }) => {
  const { color, shadow, space, radius } = useTheme()
  const insets = useSafeAreaInsets()
  // The size belongs to the tooltip it was measured for: the next one hides until it is measured too.
  const [size, setSize] = useState<(Size & { readonly id: string }) | null>(null)
  const measured = size !== null && size.id === tip.id
  const anchor = { ...tip.anchor, x: tip.anchor.x - layer.x, y: tip.anchor.y - layer.y }
  const place = measured ? placeTooltip(anchor, size, layer, insets) : null
  return (
    <Animated.View
      entering={FadeIn.duration(140).easing(easeOut)}
      exiting={FadeOut.duration(90)}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        // Moved with a transform: an offset would narrow the room the text wraps in.
        transform: [{ translateX: place?.left ?? 0 }, { translateY: place?.top ?? 0 }]
      }}
    >
      <View
        nativeID={tip.id}
        role="tooltip"
        onLayout={({ nativeEvent: { layout } }) => {
          if (size?.id === tip.id && size.width === layout.width && size.height === layout.height) return
          setSize({ id: tip.id, width: layout.width, height: layout.height })
        }}
        style={{
          maxWidth: Math.min(MAX_WIDTH, layer.width - TOOLTIP_MARGIN * 2),
          opacity: measured ? 1 : 0,
          ...shadow(2)
        }}
      >
        {place ? (
          <View
            style={{
              position: "absolute",
              left: place.arrow - ARROW / 2,
              ...(place.placement === "above" ? { bottom: -ARROW / 2 + 1 } : { top: -ARROW / 2 + 1 }),
              width: ARROW,
              height: ARROW,
              borderRadius: 3,
              backgroundColor: color.ink,
              transform: [{ rotate: "45deg" }]
            }}
          />
        ) : null}
        <View
          style={{
            backgroundColor: color.ink,
            borderRadius: radius.sm,
            paddingHorizontal: space.md,
            paddingVertical: 9
          }}
        >
          <Text variant="small" color="onPrimaryDark" style={{ lineHeight: 18 }}>
            {tip.text}
          </Text>
          {tip.note ? (
            <Text variant="caption" color="onPrimaryDark" style={{ marginTop: 5, opacity: 0.72 }}>
              {tip.note}
            </Text>
          ) : null}
        </View>
      </View>
    </Animated.View>
  )
}

/**
 * Holds the one open tooltip and draws it over the whole app, so a card's edge or a scroll view
 * can't clip it. A tooltip closes when the page scrolls, the route changes, the screen resizes or
 * rotates, Escape is pressed, or something else is pressed or touched. A touch elsewhere still does
 * what it would have: it scrolls or presses as if no tooltip were open.
 */
export const TooltipProvider = ({ children }: { readonly children: ReactNode }) => {
  const [tip, setTip] = useState<Tip | null>(null)
  const [layer, setLayer] = useState<Box | null>(null)
  const layerRef = useRef<View>(null)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedAt = useRef(0)
  const openRef = useRef<Tip | null>(null)
  /** The trigger the current touch landed on, set by it before the touch bubbles up to here. */
  const touched = useRef<string | null>(null)

  const close = useCallback(() => {
    if (closing.current !== null) clearTimeout(closing.current)
    closing.current = null
    if (openRef.current !== null) closedAt.current = Date.now()
    openRef.current = null
    setTip(null)
  }, [])

  // Stable, so a trigger's effects don't re-run each time a tooltip opens or closes.
  const actions = useMemo<Omit<Tooltips, "open">>(
    () => ({
      show: (next) => {
        if (closing.current !== null) clearTimeout(closing.current)
        closing.current = null
        openRef.current = next
        // The layer's place in the window, read with the trigger's, so the two share coordinates.
        layerRef.current?.measureInWindow((x, y, width, height) => {
          if (openRef.current !== next) return
          setLayer({ x, y, width, height })
          setTip(next)
        })
      },
      hide: (id, delay = 0) => {
        if (openRef.current?.id !== id) return
        if (closing.current !== null) clearTimeout(closing.current)
        if (delay === 0) close()
        else closing.current = setTimeout(close, delay)
      },
      warm: () => openRef.current !== null || Date.now() - closedAt.current < WARM_MS,
      close,
      claim: (id) => {
        touched.current = id
      }
    }),
    [close]
  )
  const open = tip?.id ?? null
  const tooltips = useMemo<Tooltips>(() => ({ open, ...actions }), [open, actions])

  const pathname = usePathname()
  useEffect(close, [pathname, close])
  useEffect(
    () => () => {
      if (closing.current !== null) clearTimeout(closing.current)
    },
    []
  )

  useEffect(() => {
    if (WEB) return
    const rotated = Dimensions.addEventListener("change", close)
    return () => rotated.remove()
  }, [close])

  // A touch bubbles up from where it landed, so a trigger has claimed it by the time it gets here.
  const touchStart = () => {
    const own = touched.current
    touched.current = null
    if (openRef.current !== null && openRef.current.id !== own) close()
  }

  useEffect(() => {
    if (!WEB || tip === null) return
    const pressed = (event: Event) => {
      const node = tip.node as Node | null
      if (node !== null && event.target instanceof Node && node.contains(event.target)) return
      close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    // Capturing: the page's scroll views scroll, not the window, and their scrolls don't bubble.
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    window.addEventListener("pointerdown", pressed, true)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("pointerdown", pressed, true)
      window.removeEventListener("keydown", key)
    }
  }, [tip, close])

  return (
    <TooltipContext.Provider value={tooltips}>
      <View style={{ flex: 1 }} onTouchStart={WEB ? undefined : touchStart}>
        {children}
        <View ref={layerRef} pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
          {tip !== null && layer !== null ? <Bubble tip={tip} layer={layer} /> : null}
        </View>
      </View>
    </TooltipContext.Provider>
  )
}

/**
 * Something that explains itself in a tooltip: on hover or keyboard focus with a mouse and
 * keyboard, on a tap with a finger (a second tap, or a tap anywhere else, closes it). A click
 * pins it open until a second click, or a click anywhere else. Screen readers get the text as the
 * control's description, without opening anything.
 */
export const TooltipTrigger = ({
  text,
  note,
  label,
  children
}: {
  readonly text: string
  /** A fainter line under the text. */
  readonly note?: string
  /** The control's accessible name. */
  readonly label: string
  readonly children: (open: boolean) => ReactNode
}) => {
  const id = useId()
  const descriptionId = `${id}-description`
  const description = note ? `${text} ${note}` : text
  const { open, show, hide, warm, claim } = useContext(TooltipContext)
  const ref = useRef<View>(null)
  const hovered = useRef(false)
  /** Clicked open under a mouse: leaving no longer closes it. */
  const pinned = useRef(false)
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped by every reveal and every cancel, so a measurement that comes back too late is dropped. */
  const request = useRef(0)
  const isOpen = open === id

  // However it closed (a press elsewhere, Escape, a scroll, another tooltip), it is no longer pinned.
  useEffect(() => {
    if (!isOpen) pinned.current = false
  }, [isOpen])

  const wait = (ms: number | null, then?: () => void) => {
    if (waiting.current !== null) clearTimeout(waiting.current)
    waiting.current = ms === null || then === undefined ? null : setTimeout(then, ms)
  }
  const reveal = () => {
    wait(null)
    const asked = ++request.current
    ref.current?.measureInWindow((x, y, width, height) => {
      if (asked !== request.current) return
      show({ id, text, note, anchor: { x, y, width, height }, node: ref.current })
    })
  }
  const cancel = () => {
    wait(null)
    request.current++
  }

  useEffect(
    () => () => {
      if (waiting.current !== null) clearTimeout(waiting.current)
      request.current++
      hide(id)
    },
    [hide, id]
  )

  return (
    <View
      ref={ref}
      collapsable={false}
      onTouchStart={WEB ? undefined : () => claim(id)}
      style={{ alignSelf: "flex-start" }}
    >
      <PressableScale
        haptic
        scaleTo={0.95}
        onHoverIn={() => {
          hovered.current = true
          if (warm()) reveal()
          else wait(HOVER_DELAY_MS, reveal)
        }}
        onHoverOut={() => {
          hovered.current = false
          if (pinned.current) return
          cancel()
          hide(id, HOVER_GRACE_MS)
        }}
        onPress={() => {
          if (hovered.current) {
            // Under a mouse it is already open, or about to be: a click pins it, a second unpins it.
            if (pinned.current && isOpen) {
              pinned.current = false
              hide(id)
            } else {
              pinned.current = true
              reveal()
            }
          } else if (isOpen) hide(id)
          else reveal()
        }}
        onFocus={(event) => {
          // Keyboard focus only: a press focuses the control too, and opens it itself.
          const target = event.target as unknown as { matches?: (selector: string) => boolean }
          if (WEB && target.matches?.(":focus-visible")) reveal()
        }}
        onBlur={() => {
          cancel()
          hide(id)
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        // react-native-web drops `accessibilityHint`, so the web points at a hidden copy of the text.
        {...(WEB
          ? { "aria-describedby": descriptionId }
          : { accessibilityHint: description, accessibilityState: { expanded: isOpen } })}
      >
        {children(isOpen)}
      </PressableScale>
      {WEB ? (
        <Text nativeID={descriptionId} style={{ display: "none" }}>
          {description}
        </Text>
      ) : null}
    </View>
  )
}
