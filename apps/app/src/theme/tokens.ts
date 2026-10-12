/**
 * Kotori's palette is drawn from its mascot: snowy whites, the bird's ink-dark
 * wings and its rosy shoulder, set against the pale skies of a Hokkaido winter.
 */
const light = {
  background: "#FBF7F2",
  surface: "#FFFFFF",
  surfaceMuted: "#F4EEE6",
  border: "#ECE4DA",
  ink: "#2B2622",
  text: "#2B2622",
  textMuted: "#776D65",
  textFaint: "#A99F96",
  primary: "#D9786A",
  primaryPressed: "#C4655A",
  primarySoft: "#FBE8E3",
  onPrimary: "#FFFFFF",
  sky: "#5D93C2",
  skySoft: "#E4EFF8",
  matcha: "#5E9A68",
  matchaSoft: "#E3F1E3",
  yuzu: "#C79A2E",
  yuzuSoft: "#FAF0D5",
  plum: "#B85A73",
  plumSoft: "#F7E1E7",
  lavender: "#8A7BC0",
  lavenderSoft: "#ECE8F7",
  shadow: "#5B4636",
  overlay: "rgba(43, 38, 34, 0.35)"
}

export type Palette = typeof light

const dark: Palette = {
  background: "#1C1A19",
  surface: "#262321",
  surfaceMuted: "#2F2B28",
  border: "#3A3532",
  ink: "#F6F1EB",
  text: "#F6F1EB",
  textMuted: "#B8ADA4",
  textFaint: "#857A72",
  primary: "#E8897B",
  primaryPressed: "#F19A8D",
  primarySoft: "#3D2A27",
  onPrimary: "#1C1A19",
  sky: "#86B6E0",
  skySoft: "#22303B",
  matcha: "#88C292",
  matchaSoft: "#243327",
  yuzu: "#E2BA5A",
  yuzuSoft: "#3A3122",
  plum: "#DE87A0",
  plumSoft: "#3B2630",
  lavender: "#B0A3E3",
  lavenderSoft: "#2D2A3D",
  shadow: "#000000",
  overlay: "rgba(0, 0, 0, 0.5)"
}

export const palettes = { light, dark }

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const

export const fonts = {
  regular: "Nunito_400Regular",
  medium: "Nunito_600SemiBold",
  bold: "Nunito_700Bold",
  heavy: "Nunito_800ExtraBold"
} as const

/** Content width on large screens, so the web app reads like a phone-sized column. */
export const maxContentWidth = 640
