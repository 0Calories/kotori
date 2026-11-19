import { createContext, type ReactNode, useContext } from "react"
import { usePreference } from "../session/preferences.ts"
import { defaultTheme, type ThemeName, themes } from "./tokens.ts"

const ThemeContext = createContext(themes[defaultTheme])

export const useThemeName = () => usePreference<ThemeName>("theme", defaultTheme)

export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  const [name, , loaded] = useThemeName()
  if (!loaded) return null
  return <ThemeContext.Provider value={themes[name] ?? themes[defaultTheme]}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
