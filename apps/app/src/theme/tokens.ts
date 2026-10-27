import { Platform } from "react-native"

/**
 * Kotori's palette is snow and young bamboo (wakatake), with one warm accent
 * taken from the bird's rosy shoulders. Every lighter tint and darker shade of
 * green is drawn from Wakatake 500 at the same hue.
 */
const color = {
  /** Snow: the screen background. */
  background: "#F7FAF7",
  surface: "#FFFFFF",
  /** Stone: example boxes, keys and inactive fills. */
  surfaceMuted: "#ECF2ED",
  /** Line: borders, chips and empty bars. */
  border: "#D7E1D9",
  /** Dividers between rows inside a card. */
  divider: "#E9EFEA",
  /** The faint ring that lifts a white card off the snow. */
  hairline: "rgba(19, 32, 26, 0.05)",
  /** The ring around pills on the hero and the floating tab bar. */
  ring: "rgba(19, 32, 26, 0.07)",
  /** The ring around white controls: audio buttons and secondary buttons. */
  outline: "rgba(19, 32, 26, 0.08)",
  /** The line a nuance scale's dot sits on. */
  track: "rgba(19, 32, 26, 0.12)",
  ink: "#13201A",
  text: "#13201A",
  /** Ink 2: secondary text. */
  textMuted: "#515E58",
  /** Ink 3, darkened from the mock's #78837E so small text keeps 4.5:1 on snow and white. */
  textFaint: "#66716C",
  /** Wakatake 500: buttons, the selected segment and checks, with ink text on top. */
  primary: "#81B38E",
  primaryPressed: "#649571",
  /** 100: the hero, large surfaces, and behind badges, pills and selected icons. */
  primaryTint: "#DBF2E0",
  /** 200: comparison bands and fading bars. */
  primarySoft: "#C3E5CB",
  /** 800: marks on charts and scales, numbered badges. White text on it is 7.5:1. */
  primaryDark: "#355D41",
  /** 900: green text on tints. */
  primaryDeep: "#23412C",
  onPrimary: "#13201A",
  onPrimaryDark: "#FFFFFF",
  /** Rose dark: overlines, warnings, "avoid" labels and the wavy line under a mistake. */
  accent: "#B03D5B",
  /** Blush: behind warnings. */
  accentSoft: "#FFEEF0",
  /** The marker behind the word being looked up in an example. */
  highlight: "#FDC5CC",
  /** A pressed or selected row: ink at 7.5%. */
  selected: "rgba(19, 32, 26, 0.075)",
  shadow: "#13201A",
  overlay: "rgba(19, 32, 26, 0.35)"
}

export type Palette = typeof color

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

const radius = { sm: 14, md: 16, lg: 24, xl: 28, pill: 999 } as const

/**
 * Three families: Gabarito for the interface and English, Murecho for Japanese
 * text, and Hina Mincho for the Japanese words being learned. On the web each
 * Latin face falls through to Murecho, so Japanese inside English copy still
 * gets the Japanese face; native text picks Murecho itself (see `Text`).
 */
const latin = {
  regular: "Gabarito_400Regular",
  medium: "Gabarito_500Medium",
  semibold: "Gabarito_600SemiBold",
  bold: "Gabarito_700Bold",
  heavy: "Gabarito_800ExtraBold"
} as const

export type Weight = keyof typeof latin

const japanese: Record<Weight, string> = {
  regular: "Murecho_400Regular",
  medium: "Murecho_500Medium",
  semibold: "Murecho_500Medium",
  bold: "Murecho_700Bold",
  heavy: "Murecho_700Bold"
}

const stack = (weight: Weight) =>
  Platform.OS === "web" ? `${latin[weight]}, ${japanese[weight]}, system-ui, sans-serif` : latin[weight]

const fonts = {
  regular: stack("regular"),
  medium: stack("medium"),
  semibold: stack("semibold"),
  bold: stack("bold"),
  heavy: stack("heavy"),
  japanese,
  mincho: Platform.OS === "web" ? "HinaMincho_400Regular, Murecho_400Regular, serif" : "HinaMincho_400Regular"
} as const

export type Face = "latin" | "japanese"

/** Ascent and descent of Gabarito and Murecho (hhea, as a share of the size): where text sits in its line. */
const faceMetrics: Record<Face, { readonly ascent: number; readonly descent: number }> = {
  latin: { ascent: 0.94, descent: 0.26 },
  japanese: { ascent: 1.16, descent: 0.288 }
}

/**
 * How far the baseline sits below the top of a line box. Every platform
 * centres the glyphs in the line height, so the leading splits evenly; this
 * rounds as browsers do, which native text is within a pixel of.
 */
export const baseline = (face: Face, size: number, lineHeight: number) => {
  const ascent = Math.round(faceMetrics[face].ascent * size)
  const descent = Math.round(faceMetrics[face].descent * size)
  return Math.floor((lineHeight - ascent - descent) / 2) + ascent
}

/** Content width on large screens, so the web app reads like a phone-sized column. */
const maxContentWidth = 640

/** Soft drops that fade out before the card's edge: cards, the search field, then the tab bar. */
const shadow = (elevation: 1 | 2 | 3) => {
  const web = ["none", "0 10px 24px -18px", "0 16px 30px -16px", "0 16px 34px -14px"][elevation]!
  const opacity = [0, 0.4, 0.35, 0.42][elevation]!
  return (
    Platform.select({
      web: { boxShadow: `${web} rgba(19,32,26, ${opacity})` },
      default: {
        shadowColor: color.shadow,
        shadowOpacity: [0, 0.07, 0.1, 0.14][elevation]!,
        shadowRadius: [0, 10, 14, 18][elevation]!,
        shadowOffset: { width: 0, height: [0, 6, 10, 10][elevation]! },
        elevation: elevation * 2
      }
    }) ?? {}
  )
}

/** Palette, spacing, type, and shadows. */
export const theme = {
  color,
  space,
  radius,
  font: fonts,
  maxWidth: maxContentWidth,
  shadow
}
