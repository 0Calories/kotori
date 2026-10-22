import { createContext, type ReactNode, useContext, useMemo } from "react"
import { Platform, useColorScheme } from "react-native"
import { usePreference } from "../session/preferences.ts"
import { fonts, maxContentWidth, type Palette, palettes, radius, space } from "./tokens.ts"

/** Japanese text uses the platform's rounded Japanese face where one exists. */
const japaneseFamily = Platform.select({
  ios: "Hiragino Maru Gothic ProN",
  web: '"Hiragino Maru Gothic ProN", "Zen Maru Gothic", "M PLUS Rounded 1c", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
  default: undefined
})

export interface Theme {
  readonly dark: boolean
  readonly color: Palette
  readonly space: typeof space
  readonly radius: typeof radius
  readonly font: typeof fonts
  readonly japanese: string | undefined
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
      japanese: japaneseFamily,
      maxWidth: maxContentWidth,
      shadow: (elevation) => {
        const blur = [0, 12, 20, 32][elevation]!
        const opacity = dark ? 0.4 : [0, 0.06, 0.09, 0.14][elevation]!
        return Platform.select({
          web: { boxShadow: `0 ${elevation * 3}px ${blur}px rgba(${dark ? "0,0,0" : "91,70,54"}, ${opacity})` },
          default: {
            shadowColor: color.shadow,
            shadowOpacity: opacity,
            shadowRadius: blur / 2,
            shadowOffset: { width: 0, height: elevation * 2 },
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
