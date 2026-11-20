import { Platform } from "react-native"

export const fade = (hex: string, alpha: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${alpha})`

const wakatake = {
  background: "#F7FAF7",
  surface: "#FFFFFF",
  surfaceMuted: "#ECF2ED",
  border: "#D7E1D9",
  divider: "#E9EFEA",
  hairline: "rgba(19, 32, 26, 0.05)",
  ring: "rgba(19, 32, 26, 0.07)",
  outline: "rgba(19, 32, 26, 0.08)",
  track: "rgba(19, 32, 26, 0.12)",
  ink: "#13201A",
  text: "#13201A",
  textMuted: "#515E58",
  textFaint: "#66716C",
  primary: "#81B38E",
  primaryPressed: "#649571",
  primaryTint: "#DBF2E0",
  primarySoft: "#C3E5CB",
  primaryDark: "#355D41",
  primaryDeep: "#23412C",
  onPrimary: "#13201A",
  onPrimaryDark: "#FFFFFF",
  accent: "#B03D5B",
  accentSoft: "#FFEEF0",
  caution: "#7A4E00",
  cautionSoft: "#FFF3D6",
  highlight: "#FDC5CC",
  selected: "rgba(19, 32, 26, 0.075)",
  shadow: "#13201A",
  overlay: "rgba(19, 32, 26, 0.35)"
}

export type Palette = typeof wakatake

const sora: Palette = {
  ...wakatake,
  background: "#F6FAFC",
  surfaceMuted: "#EBF1F6",
  border: "#D5E0E7",
  divider: "#E8EEF3",
  hairline: "rgba(19, 30, 38, 0.05)",
  ring: "rgba(19, 30, 38, 0.07)",
  outline: "rgba(19, 30, 38, 0.08)",
  track: "rgba(19, 30, 38, 0.12)",
  ink: "#131E26",
  text: "#131E26",
  textMuted: "#515C64",
  textFaint: "#666F76",
  primary: "#94C1E2",
  primaryPressed: "#76A3C3",
  primaryTint: "#DAEEFE",
  primarySoft: "#C1DFF6",
  primaryDark: "#34576F",
  primaryDeep: "#223C4F",
  onPrimary: "#131E26",
  selected: "rgba(19, 30, 38, 0.075)",
  shadow: "#131E26",
  overlay: "rgba(19, 30, 38, 0.35)"
}

const palettes = { sora, wakatake }

export type ThemeName = keyof typeof palettes

export const defaultTheme: ThemeName = "sora"

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

const radius = { sm: 14, md: 16, lg: 24, xl: 28, pill: 999 } as const

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

// Gabarito and Murecho hhea ascent/descent ratios used to locate the text baseline within a line box.
const faceMetrics: Record<Face, { readonly ascent: number; readonly descent: number }> = {
  latin: { ascent: 0.94, descent: 0.26 },
  japanese: { ascent: 1.16, descent: 0.288 }
}

export const baseline = (face: Face, size: number, lineHeight: number) => {
  const ascent = Math.round(faceMetrics[face].ascent * size)
  const descent = Math.round(faceMetrics[face].descent * size)
  return Math.floor((lineHeight - ascent - descent) / 2) + ascent
}

const maxContentWidth = 640

const shadowIn = (color: Palette) => (elevation: 1 | 2 | 3) => {
  const web = ["none", "0 10px 24px -18px", "0 16px 30px -16px", "0 16px 34px -14px"][elevation]!
  const opacity = [0, 0.4, 0.35, 0.42][elevation]!
  return (
    Platform.select({
      web: { boxShadow: `${web} ${fade(color.shadow, opacity)}` },
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

export const theme = {
  space,
  radius,
  font: fonts,
  maxWidth: maxContentWidth
}

const themed = (color: Palette) => ({ ...theme, color, shadow: shadowIn(color) })

type Theme = ReturnType<typeof themed>

export const themes: Record<ThemeName, Theme> = { sora: themed(sora), wakatake: themed(wakatake) }
