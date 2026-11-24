import { createContext, type ReactNode, useContext, useEffect } from "react"
import { Platform } from "react-native"
import { syncWebTheme } from "../lib/webChrome.ts"
import { usePreference } from "../session/preferences.ts"
import { defaultTheme, type ThemeName, themes } from "./tokens.ts"

const ThemeContext = createContext(themes[defaultTheme])

/** The learner's theme choice, persisted on this device. */
export const useThemeName = () => usePreference<ThemeName>("theme", defaultTheme)

/** Renders nothing until the stored choice is read, so the splash screen covers it instead of a flash of the default. */
export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  const [name, , loaded] = useThemeName()
  // A name from a build that had a theme this one lacks falls back to the default.
  const active = themes[name] ?? themes[defaultTheme]
  useEffect(() => {
    if (loaded && Platform.OS === "web") syncWebTheme(active.color.background)
  }, [loaded, active.color.background])
  if (!loaded) return null
  return <ThemeContext.Provider value={active}>{children}</ThemeContext.Provider>
}

/** Colors and shadows from the chosen palette, with the shared spacing and type. */
export const useTheme = () => useContext(ThemeContext)
