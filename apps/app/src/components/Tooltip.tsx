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
import { Platform, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { type Box, placeTooltip, type Size, TOOLTIP_MARGIN } from "../lib/tooltip.ts"
import { useT } from "../session/SessionProvider.tsx"
import { easeOut } from "../theme/easing.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { KotoriNotesBadge } from "./KotoriMark.tsx"
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
  /** Opened by a tap on a phone: a tap anywhere else closes it. */
  readonly modal: boolean
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
}

const TooltipContext = createContext<Tooltips>({ open: null, show: () => {}, hide: () => {}, warm: () => false })

const Bubble = ({ tip, layer }: { readonly tip: Tip; readonly layer: Box }) => {
  const { color, shadow } = useTheme()
  const t = useT()
  const insets = useSafeAreaInsets()
  // A note marked ✦ says Kotori's AI added the fact: the "Kotori's Notes · AI" lockup says it for it.
  const kotoriNote = tip.note?.startsWith("✦") ?? false
  // The size belongs to the tooltip it was measured for: the next one hides until it is measured too.
  const [size, setSize] = useState<(Size & { readonly id: string }) | null>(null)
  const measured = size !== null && size.id === tip.id
  const anchor = { ...tip.anchor, x: tip.anchor.x - layer.x, y: tip.anchor.y - layer.y }
  const place = measured ? placeTooltip(anchor, size, layer, insets.top) : null
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
        <View style={{ backgroundColor: color.ink, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Text variant="small" color="onPrimaryDark" style={{ lineHeight: 18 }}>
            {tip.text}
          </Text>
          {kotoriNote ? (
            <View
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: "rgba(255, 255, 255, 0.12)"
              }}
            >
              <KotoriNotesBadge title={t.entry.sourceKotori} tone="dark" compact />
            </View>
          ) : tip.note ? (
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
 * can't clip it. A tooltip closes when the page scrolls, the route changes, Escape is pressed, or
 * something else is pressed.
 */
export const TooltipProvider = ({ children }: { readonly children: ReactNode }) => {
  const [tip, setTip] = useState<Tip | null>(null)
  const [layer, setLayer] = useState<Box | null>(null)
  const layerRef = useRef<View>(null)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedAt = useRef(0)
  const openRef = useRef<Tip | null>(null)

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
      warm: () => openRef.current !== null || Date.now() - closedAt.current < WARM_MS
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
      {children}
      <View ref={layerRef} pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
        {tip?.modal ? (
          <Pressable
            onPress={close}
            accessible={false}
            importantForAccessibility="no"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {tip !== null && layer !== null ? <Bubble tip={tip} layer={layer} /> : null}
      </View>
    </TooltipContext.Provider>
  )
}

/**
 * Something that explains itself in a tooltip: on hover or keyboard focus with a mouse and
 * keyboard, on a tap with a finger (a second tap, or a tap anywhere else, closes it). Screen
 * readers get the text as the control's description, without opening anything.
 */
export const TooltipTrigger = ({
  text,
  note,
  label,
  style,
  children
}: {
  readonly text: string
  /** A fainter line under the text. */
  readonly note?: string
  /** The control's accessible name. */
  readonly label: string
  readonly style?: StyleProp<ViewStyle>
  readonly children: ReactNode | ((open: boolean) => ReactNode)
}) => {
  const id = useId()
  const { open, show, hide, warm } = useContext(TooltipContext)
  const ref = useRef<View>(null)
  const hovered = useRef(false)
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOpen = open === id

  const wait = (ms: number | null, then?: () => void) => {
    if (waiting.current !== null) clearTimeout(waiting.current)
    waiting.current = ms === null || then === undefined ? null : setTimeout(then, ms)
  }
  const reveal = (modal: boolean) => {
    wait(null)
    ref.current?.measureInWindow((x, y, width, height) => {
      show({ id, text, note, anchor: { x, y, width, height }, modal, node: ref.current })
    })
  }

  useEffect(
    () => () => {
      if (waiting.current !== null) clearTimeout(waiting.current)
      hide(id)
    },
    [hide, id]
  )

  return (
    <View ref={ref} collapsable={false} style={{ alignSelf: "flex-start" }}>
      <PressableScale
        haptic
        scaleTo={0.95}
        onHoverIn={() => {
          hovered.current = true
          if (warm()) reveal(false)
          else wait(HOVER_DELAY_MS, () => reveal(false))
        }}
        onHoverOut={() => {
          hovered.current = false
          wait(null)
          hide(id, HOVER_GRACE_MS)
        }}
        onPress={() => {
          // Under a mouse it is already open, or about to be: a click must not close it again.
          if (hovered.current) reveal(false)
          else if (isOpen) hide(id)
          else reveal(!WEB)
        }}
        onFocus={(event) => {
          // Keyboard focus only: a press focuses the control too, and opens it itself.
          const target = event.target as unknown as { matches?: (selector: string) => boolean }
          if (WEB && target.matches?.(":focus-visible")) reveal(false)
        }}
        onBlur={() => hide(id)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={note ? `${text} ${note}` : text}
        {...(WEB ? { "aria-describedby": isOpen ? id : undefined } : { accessibilityState: { expanded: isOpen } })}
        style={style}
      >
        {typeof children === "function" ? children(isOpen) : children}
      </PressableScale>
    </View>
  )
}
