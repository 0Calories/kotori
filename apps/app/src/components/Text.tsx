import { type ReactNode } from "react"
import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native"
import type { Palette, Weight } from "../theme/tokens.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"

const variants = {
  display: { fontSize: 33, lineHeight: 35, weight: "bold", tracking: -1 },
  title: { fontSize: 25, lineHeight: 30, weight: "heavy", tracking: -0.4 },
  heading: { fontSize: 18, lineHeight: 23, weight: "bold", tracking: 0 },
  body: { fontSize: 14, lineHeight: 21, weight: "regular", tracking: 0 },
  strong: { fontSize: 16, lineHeight: 22, weight: "semibold", tracking: 0 },
  small: { fontSize: 13.5, lineHeight: 19, weight: "regular", tracking: 0 },
  caption: { fontSize: 12.5, lineHeight: 17, weight: "medium", tracking: 0 },
  label: { fontSize: 11.5, lineHeight: 14, weight: "bold", tracking: 0.9 }
} as const satisfies Record<string, { fontSize: number; lineHeight: number; weight: Weight; tracking: number }>

export type TextVariant = keyof typeof variants

const JAPANESE = /[　-ヿ㐀-鿿！-ﾟ]/

const plain = (children: ReactNode): string =>
  typeof children === "string" || typeof children === "number"
    ? String(children)
    : Array.isArray(children)
      ? children.map(plain).join("")
      : ""

export interface TextProps extends RNTextProps {
  readonly variant?: TextVariant
  readonly color?: keyof Palette
  readonly align?: TextStyle["textAlign"]
  /** Render with the Japanese face (for sentences and Japanese copy). */
  readonly jp?: boolean
  /** Render with the mincho face, for the Japanese words being learned. */
  readonly mincho?: boolean
  readonly size?: number
  readonly children?: ReactNode
}

export const Text = ({
  variant = "body",
  color = "text",
  align,
  jp,
  mincho,
  size,
  style,
  children,
  ...props
}: TextProps) => {
  const theme = useTheme()
  const spec = variants[variant]
  const fontSize = size ?? spec.fontSize
  // The web falls through from Gabarito to Murecho by itself; native text has no fallback chain.
  const japanese = jp ?? (Platform.OS !== "web" && JAPANESE.test(plain(children)))
  const lineHeight = size ? Math.round(size * (japanese || mincho ? 1.5 : 1.3)) : spec.lineHeight
  const fontFamily = mincho ? theme.font.mincho : japanese ? theme.font.japanese[spec.weight] : theme.font[spec.weight]
  return (
    <RNText
      {...props}
      style={[
        {
          color: theme.color[color],
          fontSize,
          lineHeight,
          textAlign: align,
          fontFamily,
          letterSpacing: mincho ? undefined : spec.tracking || undefined
        },
        style
      ]}
    >
      {children}
    </RNText>
  )
}
