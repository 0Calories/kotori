import { ActivityIndicator, View } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Icon, type IconName } from "./Icon.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

export interface ButtonProps {
  readonly label: string
  readonly onPress?: () => void
  /** primary: wakatake with ink text. dark: ink, for the action that finishes a flow. */
  readonly variant?: "primary" | "dark" | "secondary" | "soft" | "ghost"
  readonly size?: "md" | "lg" | "sm"
  readonly icon?: IconName
  readonly loading?: boolean
  readonly disabled?: boolean
  readonly full?: boolean
  readonly accessibilityHint?: string
}

export const Button = ({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  full,
  accessibilityHint
}: ButtonProps) => {
  const { color, radius } = useTheme()
  const palette = {
    primary: { bg: color.primary, fg: color.onPrimary, ring: color.primary },
    dark: { bg: color.ink, fg: color.background, ring: color.ink },
    secondary: { bg: color.surface, fg: color.text, ring: color.outline },
    soft: { bg: color.primaryTint, fg: color.primaryDeep, ring: color.primaryTint },
    ghost: { bg: "transparent", fg: color.text, ring: "transparent" }
  }[variant]
  const height = { sm: 36, md: 44, lg: 52 }[size]
  const inactive = disabled || loading
  // Play is the one filled glyph, drawn larger and closer to the edge, with a bolder label (the Listen pill).
  const play = icon === "play_arrow"
  return (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={size === "sm" ? 4 : 0}
      style={{
        height,
        paddingLeft: icon ? (size === "sm" ? 10 : play ? 12 : 14) : size === "sm" ? 14 : 20,
        paddingRight: size === "sm" ? 14 : icon ? 18 : 20,
        borderRadius: radius.pill,
        backgroundColor: palette.bg,
        borderWidth: 1,
        borderColor: palette.ring,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
        opacity: disabled ? 0.45 : 1,
        alignSelf: full ? "stretch" : undefined
      }}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : icon ? (
        <Icon name={icon} size={size === "sm" ? 18 : play ? 24 : 19} color={palette.fg} filled={play} />
      ) : null}
      <View>
        <Text
          variant="strong"
          weight={play ? "bold" : "semibold"}
          style={{ color: palette.fg, fontSize: size === "lg" ? 16 : 14, lineHeight: 20 }}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  )
}

/**
 * An icon-only control. `plain` is a bare glyph, as in headers; `surface` is
 * the white round button used for audio. Hit areas are never under 44pt.
 */
export const IconButton = ({
  icon,
  onPress,
  label,
  tone = "plain",
  size = 44,
  active,
  filled
}: {
  readonly icon: IconName
  readonly onPress?: () => void
  readonly label: string
  readonly tone?: "plain" | "muted" | "surface" | "primary"
  readonly size?: number
  /** Toggled on, e.g. saved or playing. */
  readonly active?: boolean
  readonly filled?: boolean
}) => {
  const { color } = useTheme()
  const background = active
    ? color.primaryDark
    : { plain: "transparent", muted: color.surfaceMuted, surface: color.surface, primary: color.primaryTint }[tone]
  return (
    <PressableScale
      haptic
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      onPress={onPress}
      hitSlop={Math.max((44 - size) / 2, 0)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
        borderWidth: tone === "surface" && !active ? 1 : 0,
        borderColor: color.outline
      }}
    >
      <Icon
        name={icon}
        size={tone === "plain" ? Math.round(size * 0.52) : Math.round(size * 0.44)}
        filled={filled ?? active}
        color={active ? color.onPrimaryDark : tone === "primary" ? color.primaryDeep : color.text}
      />
    </PressableScale>
  )
}
