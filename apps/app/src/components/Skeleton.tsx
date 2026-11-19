import { createContext, type ReactNode, useContext, useEffect } from "react"
import { type DimensionValue, type StyleProp, View, type ViewStyle } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Card } from "./Card.tsx"

/** One pulse shared by every block in a group, so a card's lines breathe together. */
const Pulse = createContext<SharedValue<number> | null>(null)

/**
 * Holds the place of content that is still loading, with a slow, gentle pulse (still when the
 * learner prefers reduced motion). Screen readers hear one "loading" for the whole group.
 */
export const SkeletonGroup = ({
  children,
  style
}: {
  readonly children: ReactNode
  readonly style?: StyleProp<ViewStyle>
}) => {
  const { t } = useSession()
  const reduceMotion = useReducedMotion()
  const pulse = useSharedValue(1)
  useEffect(() => {
    if (reduceMotion) return
    pulse.set(withRepeat(withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true))
    return () => cancelAnimation(pulse)
  }, [pulse, reduceMotion])
  return (
    <Pulse.Provider value={pulse}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t.common.loading}
        accessibilityState={{ busy: true }}
        style={style}
      >
        {children}
      </View>
    </Pulse.Provider>
  )
}

/** A placeholder bar or shape. Place it inside a `SkeletonGroup`. */
export const Skeleton = ({
  width = "100%",
  height = 14,
  radius = 7,
  tone = "muted",
  style
}: {
  readonly width?: DimensionValue
  readonly height?: DimensionValue
  readonly radius?: number
  /** `onTint` for blocks drawn on a tinted band, such as the entry's hero. */
  readonly tone?: "muted" | "onTint"
  readonly style?: StyleProp<ViewStyle>
}) => {
  const theme = useTheme()
  const pulse = useContext(Pulse)
  const breathe = useAnimatedStyle(() => ({ opacity: pulse === null ? 1 : pulse.get() }))
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: tone === "onTint" ? theme.color.primarySoft : theme.color.surfaceMuted
        },
        breathe,
        style
      ]}
    />
  )
}

/** A white card of placeholder lines: a title, then `lines` of body text. */
export const SkeletonCard = ({
  lines = 2,
  title = true,
  style
}: {
  readonly lines?: number
  readonly title?: boolean
  readonly style?: StyleProp<ViewStyle>
}) => (
  <Card style={[{ gap: 10 }, style]}>
    {title ? <Skeleton width="45%" height={20} radius={10} style={{ marginBottom: 4 }} /> : null}
    {Array.from({ length: lines }, (_, index) => (
      <Skeleton key={index} width={index === lines - 1 && lines > 1 ? "70%" : "100%"} />
    ))}
  </Card>
)

/** A list card of placeholder rows, standing in for search results or saved notes. */
export const SkeletonRows = ({ rows = 3 }: { readonly rows?: number }) => {
  const theme = useTheme()
  return (
    <Card list padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={{
            paddingVertical: 14,
            gap: 8,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.color.divider
          }}
        >
          <Skeleton width="35%" height={20} radius={10} />
          <Skeleton width="80%" height={12} radius={6} />
        </View>
      ))}
    </Card>
  )
}
