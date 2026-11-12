// Each weight from its own module: the packages' root exports would bundle every weight.
import { Gabarito_400Regular } from "@expo-google-fonts/gabarito/400Regular"
import { Gabarito_500Medium } from "@expo-google-fonts/gabarito/500Medium"
import { Gabarito_600SemiBold } from "@expo-google-fonts/gabarito/600SemiBold"
import { Gabarito_700Bold } from "@expo-google-fonts/gabarito/700Bold"
import { Gabarito_800ExtraBold } from "@expo-google-fonts/gabarito/800ExtraBold"
import { HinaMincho_400Regular } from "@expo-google-fonts/hina-mincho/400Regular"
import { Murecho_400Regular } from "@expo-google-fonts/murecho/400Regular"
import { Murecho_500Medium } from "@expo-google-fonts/murecho/500Medium"
import { Murecho_700Bold } from "@expo-google-fonts/murecho/700Bold"
import * as Sentry from "@sentry/react-native"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { setAudioModeAsync } from "expo-audio"
import { FontDisplay, useFonts } from "expo-font"
import { Stack, usePathname } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { isRunningInExpoGo } from "expo"
import { useEffect } from "react"
import { Platform } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { retryOffline } from "../src/api/errors.ts"
import { Button } from "../src/components/Button.tsx"
import { iconFonts } from "../src/components/Icon.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { MascotMessage } from "../src/components/States.tsx"
import { isUnguardedRoute } from "../src/lib/legal.ts"
import { SessionProvider, useSession } from "../src/session/SessionProvider.tsx"
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider.tsx"

// Errors and traces go to Sentry (project `sparkwright/kotori-app`). The DSN only allows sending
// events, and every shipped bundle contains it anyway. Development builds stay quiet unless
// EXPO_PUBLIC_SENTRY_IN_DEV=on.
Sentry.init({
  dsn: "https://545a5bb03825fe26735e49c85aa3fbff@o4511310091124736.ingest.us.sentry.io/4512368599564288",
  enabled: !__DEV__ || process.env.EXPO_PUBLIC_SENTRY_IN_DEV === "on",
  environment: __DEV__ ? "development" : "production",
  // The commit for web builds (set by CI); native builds default to the app version and build number.
  release: process.env.EXPO_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: __DEV__ ? 1 : 0.2,
  // Native replay of the moments before an error, with all text and images masked.
  replaysOnErrorSampleRate: 1,
  replaysSessionSampleRate: 0,
  integrations: [Sentry.mobileReplayIntegration()],
  enableNativeFramesTracking: !isRunningInExpoGo()
})

SplashScreen.preventAutoHideAsync().catch(() => {})
// Pronunciation should play even when the phone's ring switch is on silent.
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})

// The Japanese faces are several megabytes each. Apps bundle them; the web shows
// the page without waiting and swaps them in as they arrive.
const swap = (uri: number) => ({ uri, display: FontDisplay.SWAP })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryOffline, refetchOnWindowFocus: false, staleTime: 30_000 } }
})

// expo-status-bar icon color. A binding, so oxlint does not treat the attribute as a view style.
const statusBarStyle = "dark" as const

const Navigator = ({ fontsLoaded }: { readonly fontsLoaded: boolean }) => {
  const theme = useTheme()
  const { status, t, retry } = useSession()
  // Public legal pages (/privacy, /terms) need neither a session nor the API.
  const unguarded = isUnguardedRoute(usePathname())
  const ready = fontsLoaded && (unguarded || status !== "loading")

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  if ((status === "offline" || status === "unavailable") && !unguarded) {
    return (
      <Screen bottomInset={40}>
        <MascotMessage
          mood={status === "offline" ? "sleepy" : "oops"}
          title={t.appName}
          body={status === "offline" ? t.common.offline : t.common.errors.trouble}
          size={140}
        >
          <Button label={t.common.retry} icon="refresh" onPress={retry} />
        </MascotMessage>
      </Screen>
    )
  }

  return (
    <>
      <StatusBar style={statusBarStyle} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.background } }}>
        {/* Unguarded: public legal pages open without signing in. */}
        <Stack.Screen name="privacy" />
        <Stack.Screen name="terms" />
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="entry/[id]" />
          <Stack.Screen name="sources/[id]" />
          <Stack.Screen name="saved" />
          <Stack.Screen name="settings" options={{ presentation: "modal" }} />
          <Stack.Screen name="review/session" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "onboarding"}>
          <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "pending"}>
          <Stack.Screen name="pending" options={{ animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="welcome" options={{ animation: "fade" }} />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>
      </Stack>
    </>
  )
}

function RootLayout() {
  const [latinLoaded, latinError] = useFonts({
    Gabarito_400Regular,
    Gabarito_500Medium,
    Gabarito_600SemiBold,
    Gabarito_700Bold,
    Gabarito_800ExtraBold,
    ...iconFonts
  })
  const [japaneseLoaded, japaneseError] = useFonts({
    Murecho_400Regular: swap(Murecho_400Regular),
    Murecho_500Medium: swap(Murecho_500Medium),
    Murecho_700Bold: swap(Murecho_700Bold),
    HinaMincho_400Regular: swap(HinaMincho_400Regular)
  })
  const fontsLoaded =
    (latinLoaded || latinError !== null) && (Platform.OS === "web" || japaneseLoaded || japaneseError !== null)
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ThemeProvider>
              <Navigator fontsLoaded={fontsLoaded} />
            </ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

export default Sentry.wrap(RootLayout)
