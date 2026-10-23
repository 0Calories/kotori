import { createContext, type ReactNode, useContext, useMemo } from "react"
import { Platform, useColorScheme } from "react-native"
import { usePreference } from "../session/preferences.ts"
import { fonts, maxContentWidth, type Palette, palettes, radius, space } from "./tokens.ts"

export interface Theme {
  readonly dark: boolean
  readonly color: Palette
  readonly space: typeof space
  readonly radius: typeof radius
  readonly font: typeof fonts
  readonly maxWidth: number
  readonly shadow: (elevation: 1 | 2 | 3) => object
}

const ThemeContext = createContext<Theme | null>(null)

export type Appearance = "system" | "light" | "dark"

export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  const system = useColorScheme()
  const [appearance] = usePreference<Appearance>("appearance", "system")
  const scheme = appearance === "system" ? system : appearance
  const theme = useMemo<Theme>(() => {
    const dark = scheme === "dark"
    const color = dark ? palettes.dark : palettes.light
    return {
      dark,
      color,
      space,
      radius,
      font: fonts,
      maxWidth: maxContentWidth,
      // Soft drops that fade out before the card's edge: cards, the search field, then the tab bar.
      shadow: (elevation) => {
        const tone = dark ? "0,0,0" : "19,32,26"
        const web = ["none", "0 10px 24px -18px", "0 16px 30px -16px", "0 16px 34px -14px"][elevation]!
        const opacity = dark ? 0.6 : [0, 0.4, 0.35, 0.42][elevation]!
        return Platform.select({
          web: { boxShadow: `${web} rgba(${tone}, ${opacity})` },
          default: {
            shadowColor: color.shadow,
            shadowOpacity: dark ? 0.4 : [0, 0.07, 0.1, 0.14][elevation]!,
            shadowRadius: [0, 10, 14, 18][elevation]!,
            shadowOffset: { width: 0, height: [0, 6, 10, 10][elevation]! },
            elevation: elevation * 2
          }
        })!
      }
    }
  }, [scheme])
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const theme = useContext(ThemeContext)
  if (theme === null) throw new Error("useTheme must be used inside ThemeProvider")
  return theme
}
