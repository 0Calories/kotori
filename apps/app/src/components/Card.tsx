import { type ReactNode } from "react"
import { type StyleProp, View, type ViewProps, type ViewStyle } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"

/**
 * White cards float on the snow with a hairline ring and a soft drop; tinted
 * cards (muted stone, primary tint, accent blush) sit flat.
 */
export const Card = ({
  children,
  style,
  padded = true,
  tone,
  ...props
}: Omit<ViewProps, "style"> & {
  readonly children?: ReactNode
  readonly style?: StyleProp<ViewStyle>
  readonly padded?: boolean
  readonly tone?: "surface" | "muted" | "primary" | "accent"
}) => {
  const theme = useTheme()
  const raised = tone === undefined || tone === "surface"
  const background = {
    surface: theme.color.surface,
    muted: theme.color.surfaceMuted,
    primary: theme.color.primaryTint,
    accent: theme.color.accentSoft
  }[tone ?? "surface"]
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: background,
          borderRadius: theme.radius.lg,
          padding: padded ? theme.space.lg : 0,
          borderWidth: raised ? 1 : 0,
          borderColor: theme.color.hairline
        },
        raised ? theme.shadow(1) : null,
        style
      ]}
    >
      {children}
    </View>
  )
}
