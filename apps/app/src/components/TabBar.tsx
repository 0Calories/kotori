import Ionicons from "@expo/vector-icons/Ionicons"
import { BlurView } from "expo-blur"
import type { Tabs } from "expo-router"
import type { ComponentProps } from "react"
import { Platform, View } from "react-native"
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useT } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0]

const ICONS: Record<string, readonly [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  index: ["book", "book-outline"],
  check: ["checkmark-circle", "checkmark-circle-outline"],
  say: ["chatbubble-ellipses", "chatbubble-ellipses-outline"],
  review: ["layers", "layers-outline"]
}

const Tab = ({
  name,
  label,
  focused,
  onPress,
  badge
}: {
  readonly name: string
  readonly label: string
  readonly focused: boolean
  readonly onPress: () => void
  readonly badge?: number
}) => {
  const { color, radius } = useTheme()
  const pill = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, { duration: 250, dampingRatio: 1 }),
    transform: [{ scale: withSpring(focused ? 1 : 0.85, { duration: 300, dampingRatio: 0.7 }) }]
  }))
  const [active, inactive] = ICONS[name] ?? ["ellipse", "ellipse-outline"]
  return (
    <PressableScale
      haptic
      scaleTo={0.92}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 58 }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 6,
            bottom: 6,
            left: 6,
            right: 6,
            borderRadius: radius.lg,
            backgroundColor: color.primarySoft
          },
          pill
        ]}
      />
      <View>
        <Ionicons name={focused ? active : inactive} size={22} color={focused ? color.primary : color.textMuted} />
        {badge ? (
          <View
            style={{
              position: "absolute",
              top: -4,
              right: -10,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: color.primary,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4
            }}
          >
            <Text variant="label" style={{ color: color.onPrimary, fontSize: 10, lineHeight: 12 }}>
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        variant="caption"
        style={{ fontSize: 11, lineHeight: 14, marginTop: 2, color: focused ? color.primary : color.textMuted }}
      >
        {label}
      </Text>
    </PressableScale>
  )
}

/** A floating, rounded tab bar that sits above the content. */
export const TabBar = ({
  state,
  navigation,
  badges
}: BottomTabBarProps & { readonly badges?: Record<string, number> }) => {
  const theme = useTheme()
  const t = useT()
  const insets = useSafeAreaInsets()
  const labels: Record<string, string> = {
    index: t.tabs.dictionary,
    check: t.tabs.check,
    say: t.tabs.say,
    review: t.tabs.review
  }
  const bar = (
    <View style={{ flexDirection: "row", paddingHorizontal: 6 }}>
      {state.routes.map((route, index) => (
        <Tab
          key={route.key}
          name={route.name}
          label={labels[route.name] ?? route.name}
          focused={state.index === index}
          badge={badges?.[route.name]}
          onPress={() => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
            if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name)
          }}
        />
      ))}
    </View>
  )
  const shell = {
    position: "absolute" as const,
    left: 16,
    right: 16,
    bottom: Math.max(insets.bottom, 12),
    maxWidth: 520,
    alignSelf: "center" as const,
    marginHorizontal: "auto" as const,
    borderRadius: theme.radius.xl,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow(3)
  }
  return Platform.OS === "ios" ? (
    <BlurView
      intensity={60}
      tint={theme.dark ? "dark" : "light"}
      style={[shell, { backgroundColor: theme.dark ? "rgba(38,35,33,0.6)" : "rgba(255,255,255,0.7)" }]}
    >
      {bar}
    </BlurView>
  ) : (
    <View style={[shell, { backgroundColor: theme.dark ? "rgba(38,35,33,0.96)" : "rgba(255,255,255,0.96)" }]}>
      {bar}
    </View>
  )
}
