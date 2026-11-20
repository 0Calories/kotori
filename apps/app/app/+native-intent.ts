import type { NativeIntent } from "expo-router"
import { isNativeAuthCallback } from "../src/auth/googleReturn.ts"

// Android Custom Tabs delivers kotori://auth/callback via Linking to both expo-web-browser and Expo Router, so keep Expo Router from navigating away.
export const redirectSystemPath: NonNullable<NativeIntent["redirectSystemPath"]> = ({ path, initial }) => {
  if (isNativeAuthCallback(path)) return initial ? "/" : null
  return path
}
