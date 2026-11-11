import type { NativeIntent } from "expo-router"
import { isNativeAuthCallback } from "../src/auth/googleReturn.ts"

/**
 * Keeps Android's OAuth return (`kotori://auth/callback?...`, delivered via `Linking`
 * when Custom Tabs finishes) out of Expo Router: `expo-web-browser` reads the same
 * `Linking` event directly, while the screen that started the flow stays put.
 */
export const redirectSystemPath: NonNullable<NativeIntent["redirectSystemPath"]> = ({ path, initial }) => {
  if (isNativeAuthCallback(path)) return initial ? "/" : null
  return path
}
