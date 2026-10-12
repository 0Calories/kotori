import { type ReactNode } from "react"
import { type RefreshControlProps, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

/** A scrolling page with safe-area padding, centred into a readable column on wide screens. */
export const Screen = (
  { children, bottomInset = 110, refreshControl, scroll = true }: {
    readonly children: ReactNode
    /** Room left for the floating tab bar. */
    readonly bottomInset?: number
    readonly refreshControl?: React.ReactElement<RefreshControlProps>
    readonly scroll?: boolean
  }
) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const content = {
    width: "100%" as const,
    maxWidth: theme.maxWidth,
    alignSelf: "center" as const,
    paddingTop: insets.top + theme.space.lg,
    paddingBottom: insets.bottom + bottomInset,
    paddingHorizontal: theme.space.xl - 4,
    gap: theme.space.lg
  }
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.background }}>
        <View style={[content, { flex: 1 }]}>{children}</View>
      </View>
    )
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      contentContainerStyle={content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  )
}

export const Section = ({ title, children, action }: { readonly title?: string; readonly children: ReactNode; readonly action?: ReactNode }) => {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.space.md }}>
      {title
        ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 2 }}>
            <SectionTitle>{title}</SectionTitle>
            {action}
          </View>
        )
        : null}
      {children}
    </View>
  )
}

const SectionTitle = ({ children }: { readonly children: string }) => (
  <Text variant="label" color="textMuted">{children.toUpperCase()}</Text>
)
