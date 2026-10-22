import { type ReactNode } from "react"
import { type StyleProp, View, type ViewProps, type ViewStyle } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"

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
  readonly tone?: "surface" | "muted" | "primary" | "sky" | "matcha" | "yuzu" | "plum"
}) => {
  const theme = useTheme()
  const background = {
    surface: theme.color.surface,
    muted: theme.color.surfaceMuted,
    primary: theme.color.primarySoft,
    sky: theme.color.skySoft,
    matcha: theme.color.matchaSoft,
    yuzu: theme.color.yuzuSoft,
    plum: theme.color.plumSoft
  }[tone ?? "surface"]
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: background,
          borderRadius: theme.radius.lg,
          padding: padded ? theme.space.lg : 0,
          borderWidth: tone === undefined || tone === "surface" ? 1 : 0,
          borderColor: theme.color.border
        },
        tone === undefined || tone === "surface" ? theme.shadow(1) : null,
        style
      ]}
    >
      {children}
    </View>
  )
}
