import { type ReactNode } from "react"
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native"
import type { Palette } from "../theme/tokens.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"

const variants = {
  display: { fontSize: 34, lineHeight: 40, weight: "heavy" },
  title: { fontSize: 26, lineHeight: 32, weight: "heavy" },
  heading: { fontSize: 19, lineHeight: 25, weight: "bold" },
  body: { fontSize: 16, lineHeight: 23, weight: "regular" },
  strong: { fontSize: 16, lineHeight: 23, weight: "bold" },
  small: { fontSize: 14, lineHeight: 20, weight: "regular" },
  caption: { fontSize: 13, lineHeight: 18, weight: "medium" },
  label: { fontSize: 12, lineHeight: 16, weight: "heavy" }
} as const

export type TextVariant = keyof typeof variants

export interface TextProps extends RNTextProps {
  readonly variant?: TextVariant
  readonly color?: keyof Palette
  readonly align?: TextStyle["textAlign"]
  /** Render with the Japanese face (for headwords and sentences). */
  readonly jp?: boolean
  readonly size?: number
  readonly children?: ReactNode
}

export const Text = ({ variant = "body", color = "text", align, jp, size, style, ...props }: TextProps) => {
  const theme = useTheme()
  const spec = variants[variant]
  const fontSize = size ?? spec.fontSize
  const lineHeight = size ? Math.round(size * 1.3) : spec.lineHeight
  const latin = theme.font[spec.weight]
  return (
    <RNText
      {...props}
      style={[
        {
          color: theme.color[color],
          fontSize,
          lineHeight,
          textAlign: align,
          fontFamily: jp && theme.japanese ? theme.japanese : latin,
          fontWeight: jp ? (spec.weight === "regular" ? "400" : spec.weight === "medium" ? "500" : "700") : undefined,
          letterSpacing: variant === "label" ? 0.6 : undefined
        },
        style
      ]}
    />
  )
}
