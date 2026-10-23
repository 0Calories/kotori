import { BlurView } from "expo-blur"
import { LinearGradient } from "expo-linear-gradient"
import type { Tabs } from "expo-router"
import type { ComponentProps } from "react"
import { Platform, View } from "react-native"
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useT } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Icon, type IconName } from "./Icon.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0]

const ICONS: Record<string, IconName> = {
  index: "search",
  say: "forum",
  check: "spellcheck",
  review: "bookmarks"
}

/** `#RRGGBB` at the given opacity, for fading the page into the bar. */
const fade = (hex: string, alpha: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${alpha})`

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
  const { color } = useTheme()
  const pill = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, { duration: 250, dampingRatio: 1 }),
    transform: [{ scale: withSpring(focused ? 1 : 0.85, { duration: 300, dampingRatio: 0.7 }) }]
  }))
  const tint = focused ? color.text : color.textFaint
  return (
    <PressableScale
      haptic
      scaleTo={0.92}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 56, marginHorizontal: 2, gap: 3 }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            borderRadius: 28,
            backgroundColor: color.selected
          },
          pill
        ]}
      />
      <View>
        <Icon name={ICONS[name] ?? "search"} size={25} filled={focused} color={tint} />
        {badge ? (
          <View
            style={{
              position: "absolute",
              top: -4,
              right: -11,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: color.accent,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4
            }}
          >
            <Text
              variant="label"
              style={{ color: color.onPrimaryDark, fontSize: 10, lineHeight: 12, letterSpacing: 0 }}
            >
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        variant="caption"
        weight={focused ? "bold" : "medium"}
        numberOfLines={1}
        style={{ fontSize: 11, lineHeight: 13, color: tint }}
      >
        {label}
      </Text>
    </PressableScale>
  )
}

/** A floating pill of tabs over a fade, so content scrolls away beneath it. */
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
  const bottom = Math.max(insets.bottom - 6, 12)
  const bar = (
    <View style={{ flexDirection: "row", alignItems: "center", height: 66, paddingHorizontal: 3 }}>
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
    left: 18,
    right: 18,
    bottom,
    maxWidth: 520,
    alignSelf: "center" as const,
    marginHorizontal: "auto" as const,
    borderRadius: 33,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: theme.color.hairline,
    ...theme.shadow(3)
  }
  const paper = theme.color.background
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[fade(paper, 0), fade(paper, 0.86), paper]}
        locations={[0.18, 0.48, 0.68]}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bottom + 66 + 50 }}
      />
      {Platform.OS === "ios" ? (
        <BlurView
          intensity={40}
          tint={theme.dark ? "dark" : "light"}
          style={[
            shell,
            { backgroundColor: theme.dark ? fade(theme.color.surface, 0.8) : "rgba(255, 255, 255, 0.86)" }
          ]}
        >
          {bar}
        </BlurView>
      ) : (
        <View style={[shell, { backgroundColor: theme.dark ? fade(theme.color.surface, 0.97) : "#FFFFFF" }]}>
          {bar}
        </View>
      )}
    </>
  )
}
