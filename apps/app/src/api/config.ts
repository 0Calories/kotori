import Constants from "expo-constants"
import { Platform } from "react-native"

/**
 * Where the Kotori API lives. Without EXPO_PUBLIC_API_URL, use the machine
 * serving the app: the page's host on the web, Metro's host on devices.
 */
const devHost = () => {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.hostname
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost
  return hostUri?.split(":")[0] ?? "localhost"
}

export const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost()}:4000`).replace(/\/$/, "")

/** Absolute URL for API-relative paths such as audio clips. */
export const apiAsset = (path: string) => (path.startsWith("http") ? path : `${apiUrl}${path}`)
