import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react"
import { usePreference } from "../session/preferences.ts"
import { defaultTheme, type ThemeName, themes } from "./tokens.ts"

const ThemeContext = createContext(themes[defaultTheme])

// PROTOTYPE: in-memory palette override so `/proto/chips` re-themes `TooltipProvider` too without touching storage.
let devThemeOverride: ThemeName | null = null
const devThemeListeners = new Set<() => void>()

export const setDevThemeOverride = (next: ThemeName | null) => {
  devThemeOverride = next
  for (const listener of devThemeListeners) listener()
}

export const useDevThemeOverride = () =>
  useSyncExternalStore(
    (listener) => {
      devThemeListeners.add(listener)
      return () => devThemeListeners.delete(listener)
    },
    () => devThemeOverride,
    () => null
  )

/** The learner's theme choice, persisted on this device. */
export const useThemeName = () => usePreference<ThemeName>("theme", defaultTheme)

/** Renders nothing until the stored choice is read, so the splash screen covers it instead of a flash of the default. */
export const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  const [name, , loaded] = useThemeName()
  const override = useDevThemeOverride()
  if (!loaded) return null
  const active = (__DEV__ && override !== null ? override : null) ?? name
  // A name from a build that had a theme this one lacks falls back to the default.
  return <ThemeContext.Provider value={themes[active] ?? themes[defaultTheme]}>{children}</ThemeContext.Provider>
}

/** Colors and shadows from the chosen palette, with the shared spacing and type. */
export const useTheme = () => useContext(ThemeContext)
