import { type ReactNode } from "react"
import { Platform, type RefreshControlProps, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
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
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  )
}
