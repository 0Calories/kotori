import { Platform } from "react-native"

/**
 * Kotori's palette is snow and young bamboo (wakatake), with one warm accent
 * taken from the bird's rosy shoulders. Every lighter tint and darker shade of
 * green is drawn from Wakatake 500 at the same hue.
 */
const light = {
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

export type Palette = typeof light

const dark: Palette = {
  background: "#0F1712",
  surface: "#18221C",
  surfaceMuted: "#202C25",
  border: "#2E3B33",
  divider: "#25312A",
  hairline: "rgba(232, 240, 234, 0.07)",
  ring: "rgba(232, 240, 234, 0.09)",
  outline: "rgba(232, 240, 234, 0.1)",
  track: "rgba(232, 240, 234, 0.16)",
  ink: "#E8F0EA",
  text: "#E8F0EA",
  textMuted: "#A9B7AF",
  textFaint: "#8A9890",
  primary: "#81B38E",
  primaryPressed: "#94C3A0",
  primaryTint: "#1D3125",
  primarySoft: "#2B4834",
  primaryDark: "#A9D8B4",
  primaryDeep: "#C3E5CB",
  onPrimary: "#0F1712",
  onPrimaryDark: "#0F1712",
  accent: "#EE90A8",
  accentSoft: "#3A2229",
  highlight: "#6B2D3E",
  selected: "rgba(232, 240, 234, 0.09)",
  shadow: "#000000",
  overlay: "rgba(0, 0, 0, 0.5)"
}

export const palettes = { light, dark }

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

export const radius = { sm: 14, md: 16, lg: 24, xl: 28, pill: 999 } as const

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

export const fonts = {
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
export const maxContentWidth = 640
