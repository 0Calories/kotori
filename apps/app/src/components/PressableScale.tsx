import * as Haptics from "expo-haptics"
import { type ReactNode } from "react"
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native"
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated"

export interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  readonly style?: StyleProp<ViewStyle>
  readonly children?: ReactNode
  /** How far the element shrinks while pressed. */
  readonly scaleTo?: number
  readonly haptic?: boolean
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/** Pressable with a quick, springy press-down that tracks the finger, plus a light haptic tick. */
export const PressableScale = ({
  style,
  children,
  scaleTo = 0.97,
  haptic = false,
  onPressIn,
  onPressOut,
  onPress,
  ...props
}: PressableScaleProps) => {
  const reduceMotion = useReducedMotion()
  const scale = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        if (!reduceMotion) scale.value = withSpring(scaleTo, { duration: 120, dampingRatio: 1 })
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { duration: 260, dampingRatio: 0.6 })
        onPressOut?.(event)
      }}
      onPress={(event) => {
        if (haptic && Platform.OS !== "web") Haptics.selectionAsync()
        onPress?.(event)
      }}
      style={[animated, style]}
    >
      {children}
    </AnimatedPressable>
  )
}
