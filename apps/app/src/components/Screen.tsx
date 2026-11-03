import { type ReactNode, useEffect, useRef } from "react"
import { Platform, type RefreshControlProps, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  blurActiveTextField,
  blurFocusedOnScroll,
  keyboardDismissModeFor,
  pointerMovedEnough
} from "../lib/keyboard.ts"
import { useT } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { IconButton } from "./Button.tsx"
import { Text } from "./Text.tsx"

/** A scrolling page with safe-area padding, centred into a readable column on wide screens. */
export const Screen = ({
  children,
  bottomInset = 110,
  refreshControl,
  scroll = true,
  header,
  onScroll
}: {
  readonly children: ReactNode
  /** Room left for the floating tab bar. */
  readonly bottomInset?: number
  readonly refreshControl?: React.ReactElement<RefreshControlProps>
  readonly scroll?: boolean
  /** A bar that stays put above the scrolling content, such as `Header`. */
  readonly header?: ReactNode
  readonly onScroll?: (y: number) => void
}) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const column = { width: "100%" as const, maxWidth: theme.maxWidth, alignSelf: "center" as const }
  const scrollerRef = useRef<HTMLElement | null>(null)
  // Web only, on the DOM node. react-native-web's "on-drag" blurs on every
  // scroll, including the ones iOS uses to follow the caret, and its pointer
  // props do not see the gesture that actually scrolls. A vertical drag sets
  // the flag; wheel, trackpad, and caret scrolls do not.
  useEffect(() => {
    const node = scrollerRef.current
    if (Platform.OS !== "web" || node === null) return
    let dragging = false
    let x = 0
    let y = 0
    const start = (event: PointerEvent) => {
      dragging = false
      x = event.clientX
      y = event.clientY
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", end)
      window.addEventListener("pointercancel", end)
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.buttons === 0) return
      if (pointerMovedEnough(event.clientX - x, event.clientY - y)) dragging = true
    }
    const end = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      // The scroll event for this drag can land in the same frame as the release.
      requestAnimationFrame(() => {
        dragging = false
      })
    }
    const onDragScroll = () => {
      if (blurFocusedOnScroll(dragging)) blurActiveTextField()
    }
    node.addEventListener("pointerdown", start)
    node.addEventListener("scroll", onDragScroll)
    return () => {
      node.removeEventListener("pointerdown", start)
      node.removeEventListener("scroll", onDragScroll)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
  }, [])
  const content = {
    ...column,
    paddingTop: header ? theme.space.xs : insets.top + theme.space.sm,
    paddingBottom: insets.bottom + bottomInset,
    paddingHorizontal: theme.space.lg,
    gap: theme.space.lg
  }
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.background }}>
        <View style={[content, { flex: 1 }]}>{children}</View>
      </View>
    )
  }
  const scroller = (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      contentContainerStyle={content}
      ref={(node) => {
        scrollerRef.current = node instanceof HTMLElement ? node : null
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={keyboardDismissModeFor(Platform.OS)}
      refreshControl={refreshControl}
      onScroll={onScroll ? (event) => onScroll(event.nativeEvent.contentOffset.y) : undefined}
      scrollEventThrottle={onScroll ? 32 : undefined}
    >
      {children}
    </ScrollView>
  )
  if (!header) return scroller
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <View style={[column, { paddingTop: insets.top, paddingHorizontal: theme.space.lg }]}>{header}</View>
      {scroller}
    </View>
  )
}

/** The top bar of a pushed screen: back on the left, an optional title, actions on the right. */
export const Header = ({
  onBack,
  backIcon = "back",
  title,
  actions
}: {
  readonly onBack: () => void
  readonly backIcon?: "back" | "close"
  readonly title?: ReactNode
  readonly actions?: ReactNode
}) => {
  const t = useT()
  return (
    <View style={{ height: 46, flexDirection: "row", alignItems: "center", marginHorizontal: -6 }}>
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        <IconButton
          icon={backIcon === "close" ? "close" : Platform.OS === "android" ? "arrow_back" : "arrow_back_ios_new"}
          label={backIcon === "close" ? t.common.close : t.common.back}
          onPress={onBack}
        />
      </View>
      {typeof title === "string" ? (
        <Text variant="heading" size={16} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      ) : (
        title
      )}
      <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>{actions}</View>
    </View>
  )
}

export const Section = ({
  title,
  children,
  action
}: {
  readonly title?: string
  readonly children: ReactNode
  /** A note or link on the right of the title. */
  readonly action?: ReactNode
}) => {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.space.md - 2 }}>
      {title ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
            paddingHorizontal: 6,
            paddingTop: 4
          }}
        >
          <Text variant="section" accessibilityRole="header">
            {title}
          </Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  )
}
