import { BlurView } from "expo-blur"
import { LinearGradient } from "expo-linear-gradient"
import type { Tabs } from "expo-router"
import { type ComponentProps, useEffect, useRef, useState } from "react"
import { Platform, View } from "react-native"
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useT } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
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

const DISABLED_TABS: ReadonlySet<string> = new Set(["say", "check"])

const Tab = ({
  name,
  label,
  focused,
  disabled,
  tooltip,
  onPress,
  badge
}: {
  readonly name: string
  readonly label: string
  readonly focused: boolean
  readonly disabled?: boolean
  readonly tooltip?: string
  readonly onPress: () => void
  readonly badge?: number
}) => {
  const { color, radius, shadow } = useTheme()
  const [hovered, setHovered] = useState(false)
  const [tapped, setTapped] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
  const showBriefly = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    setTapped(true)
    timer.current = setTimeout(() => setTapped(false), 1800)
  }
  const pill = useAnimatedStyle(() => ({
    opacity: withSpring(focused ? 1 : 0, { duration: 250, dampingRatio: 1 }),
    transform: [{ scale: withSpring(focused ? 1 : 0.85, { duration: 300, dampingRatio: 0.7 }) }]
  }))
  const tint = focused ? color.text : color.textFaint
  const showTooltip = Boolean(disabled && tooltip && (hovered || tapped))
  return (
    <PressableScale
      haptic={!disabled}
      scaleTo={disabled ? 1 : 0.92}
      disabled={disabled}
      pointerEvents="auto"
      onPress={disabled ? undefined : onPress}
      onPointerEnter={disabled ? () => setHovered(true) : undefined}
      onPointerLeave={
        disabled
          ? () => {
              setHovered(false)
              setTapped(false)
            }
          : undefined
      }
      onTouchStart={disabled ? showBriefly : undefined}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused, disabled: !!disabled }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityHint={disabled ? tooltip : undefined}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 56, marginHorizontal: 2, gap: 3 }}
    >
      {showTooltip ? (
        <View
          role="tooltip"
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 64,
            left: -80,
            right: -80,
            alignItems: "center",
            zIndex: 10
          }}
        >
          <View
            style={{
              backgroundColor: color.ink,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: radius.pill,
              ...shadow(2)
            }}
          >
            <Text
              variant="caption"
              weight="medium"
              numberOfLines={1}
              style={{ color: color.onPrimaryDark, fontSize: 12, lineHeight: 16 }}
            >
              {tooltip}
            </Text>
          </View>
        </View>
      ) : null}
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
      <View style={disabled ? { opacity: 0.45 } : undefined}>
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
        style={{ fontSize: 11, lineHeight: 13, letterSpacing: 0.11, color: tint, opacity: disabled ? 0.45 : 1 }}
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
    <View style={{ flexDirection: "row", alignItems: "center", height: 66, paddingHorizontal: 5 }}>
      {state.routes.map((route, index) => {
        const disabled = DISABLED_TABS.has(route.name)
        return (
          <Tab
            key={route.key}
            name={route.name}
            label={labels[route.name] ?? route.name}
            focused={state.index === index}
            disabled={disabled}
            tooltip={disabled ? t.tabs.notReady : undefined}
            badge={badges?.[route.name]}
            onPress={() => {
              if (disabled) return
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
              if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name)
            }}
          />
        )
      })}
    </View>
  )
  // `left` and `right` together with `maxWidth` pin the bar to the leading edge once
  // the max width wins, so center it in a full-width dock instead. `box-none` keeps
  // taps on the page beside the bar working.
  const dock = {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom,
    paddingHorizontal: 18,
    alignItems: "center" as const
  }
  const shell = {
    width: "100%" as const,
    maxWidth: 520,
    borderRadius: 33,
    borderWidth: 1,
    borderColor: theme.color.ring,
    backgroundColor: Platform.OS === "ios" ? "rgba(255, 255, 255, 0.86)" : "#FFFFFF",
    ...theme.shadow(3)
  }
  const paper = theme.color.background
  const floating = (
    <View style={shell}>
      {Platform.OS === "ios" ? (
        <BlurView
          intensity={40}
          tint="light"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 33, overflow: "hidden" }}
        />
      ) : null}
      {bar}
    </View>
  )
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[fade(paper, 0), fade(paper, 0.86), paper]}
        locations={[0.18, 0.48, 0.68]}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bottom + 66 + 50 }}
      />
      <View pointerEvents="box-none" style={dock}>
        {floating}
      </View>
    </>
  )
}
