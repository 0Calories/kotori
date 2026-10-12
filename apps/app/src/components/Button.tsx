import Ionicons from "@expo/vector-icons/Ionicons"
import { ActivityIndicator, View } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

export interface ButtonProps {
  readonly label: string
  readonly onPress?: () => void
  readonly variant?: "primary" | "secondary" | "soft" | "ghost"
  readonly size?: "md" | "lg" | "sm"
  readonly icon?: keyof typeof Ionicons.glyphMap
  readonly loading?: boolean
  readonly disabled?: boolean
  readonly full?: boolean
  readonly accessibilityHint?: string
}

export const Button = ({ label, onPress, variant = "primary", size = "md", icon, loading, disabled, full, accessibilityHint }: ButtonProps) => {
  const { color, radius, font } = useTheme()
  const palette = {
    primary: { bg: color.primary, fg: color.onPrimary, border: color.primary },
    secondary: { bg: color.surface, fg: color.text, border: color.border },
    soft: { bg: color.primarySoft, fg: color.primary, border: color.primarySoft },
    ghost: { bg: "transparent", fg: color.primary, border: "transparent" }
  }[variant]
  const height = { sm: 36, md: 48, lg: 56 }[size]
  const inactive = disabled || loading
  return (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={{
        height,
        paddingHorizontal: size === "sm" ? 14 : 22,
        borderRadius: radius.pill,
        backgroundColor: palette.bg,
        borderWidth: 1.5,
        borderColor: palette.border,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        opacity: disabled ? 0.45 : 1,
        alignSelf: full ? "stretch" : undefined
      }}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : icon ? <Ionicons name={icon} size={size === "sm" ? 16 : 19} color={palette.fg} /> : null}
      <View>
        <Text style={{ color: palette.fg, fontFamily: font.heavy, fontSize: size === "sm" ? 14 : 16 }}>{label}</Text>
      </View>
    </PressableScale>
  )
}

export const IconButton = (
  { icon, onPress, label, tone = "muted", size = 40, active }: {
    readonly icon: keyof typeof Ionicons.glyphMap
    readonly onPress?: () => void
    readonly label: string
    readonly tone?: "muted" | "primary"
    readonly size?: number
    readonly active?: boolean
  }
) => {
  const { color } = useTheme()
  return (
    <PressableScale
      haptic
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? color.primary : tone === "primary" ? color.primarySoft : color.surfaceMuted
      }}
    >
      <Ionicons name={icon} size={size * 0.48} color={active ? color.onPrimary : tone === "primary" ? color.primary : color.textMuted} />
    </PressableScale>
  )
}
