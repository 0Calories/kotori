import { type ReactNode } from "react"
import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native"
import { useInterfaceLanguage } from "../session/SessionProvider.tsx"
import { theme, type Palette, type Weight } from "../theme/tokens.ts"

interface Spec {
  readonly fontSize: number
  readonly lineHeight: number
  readonly weight: Weight
  readonly tracking: number
}

const variants = {
  display: { fontSize: 33, lineHeight: 35, weight: "bold", tracking: -1 },
  title: { fontSize: 25, lineHeight: 29, weight: "heavy", tracking: -0.5 },
  /** The title above a group of cards. */
  section: { fontSize: 18, lineHeight: 23, weight: "bold", tracking: 0 },
  heading: { fontSize: 18, lineHeight: 23, weight: "bold", tracking: 0 },
  body: { fontSize: 14, lineHeight: 21, weight: "regular", tracking: 0 },
  strong: { fontSize: 16, lineHeight: 22, weight: "semibold", tracking: 0 },
  small: { fontSize: 13.5, lineHeight: 19, weight: "regular", tracking: 0 },
  caption: { fontSize: 12.5, lineHeight: 17, weight: "medium", tracking: 0 },
  label: { fontSize: 11.5, lineHeight: 14, weight: "bold", tracking: 0.92 }
} as const satisfies Record<string, Spec>

type TextVariant = keyof typeof variants

/**
 * Japanese copy is set in Murecho a little smaller and looser than English, as
 * in the mock: 30/1.22 titles, 17/1.3 headings, 13.5/1.6 body and 13/1.45 small.
 */
const japaneseVariants: Partial<Record<TextVariant, Spec>> = {
  display: { fontSize: 30, lineHeight: 37, weight: "bold", tracking: -0.3 },
  title: { fontSize: 25, lineHeight: 30, weight: "heavy", tracking: -0.25 },
  heading: { fontSize: 17, lineHeight: 22, weight: "bold", tracking: 0 },
  body: { fontSize: 13.5, lineHeight: 21.5, weight: "regular", tracking: 0 },
  small: { fontSize: 13, lineHeight: 19, weight: "regular", tracking: 0 }
}

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
  /** Overrides the variant's weight, e.g. medium Japanese sentences at a custom size. */
  readonly weight?: Weight
  readonly children?: ReactNode
}

export const Text = ({
  variant = "body",
  color = "text",
  align,
  jp,
  mincho,
  size,
  weight,
  style,
  children,
  ...props
}: TextProps) => {
  const ui = useInterfaceLanguage()
  const detected = jp === undefined && JAPANESE.test(plain(children))
  // Japanese copy in a Japanese interface is set in Murecho throughout, Latin letters included.
  const japaneseCopy = jp ?? (detected && ui === "ja")
  // Native text has no fallback chain, so any Japanese needs the Japanese face; the web falls through to it.
  const japanese = japaneseCopy || (detected && Platform.OS !== "web")
  const spec = (japaneseCopy ? japaneseVariants[variant] : undefined) ?? variants[variant]
  const fontSize = size ?? spec.fontSize
  const lineHeight = size ? Math.round(size * (japanese || mincho ? 1.5 : 1.3)) : spec.lineHeight
  const face = weight ?? spec.weight
  const fontFamily = mincho ? theme.font.mincho : japanese ? theme.font.japanese[face] : theme.font[face]
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
