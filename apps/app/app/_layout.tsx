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
import { sentryRedaction } from "../src/lib/sentryRedaction.ts"
import { SessionProvider, useSession } from "../src/session/SessionProvider.tsx"
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider.tsx"

Sentry.init({
  dsn: "https://545a5bb03825fe26735e49c85aa3fbff@o4511310091124736.ingest.us.sentry.io/4512368599564288",
  enabled: !__DEV__ || process.env.EXPO_PUBLIC_SENTRY_IN_DEV === "on",
  environment: __DEV__ ? "development" : "production",
  release: process.env.EXPO_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: __DEV__ ? 1 : 0.2,
  replaysOnErrorSampleRate: 1,
  replaysSessionSampleRate: 0,
  integrations: [Sentry.mobileReplayIntegration()],
  enableNativeFramesTracking: !isRunningInExpoGo(),
  beforeBreadcrumb: sentryRedaction.beforeBreadcrumb,
  beforeSend: sentryRedaction.beforeSend,
  beforeSendTransaction: sentryRedaction.beforeSendTransaction,
  beforeSendSpan: sentryRedaction.beforeSendSpan
})

SplashScreen.preventAutoHideAsync().catch(() => {})
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})

// Multi-megabyte CJK fonts swap in asynchronously on web instead of blocking first paint.
const swap = (uri: number) => ({ uri, display: FontDisplay.SWAP })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryOffline, refetchOnWindowFocus: false, staleTime: 30_000 } }
})

// Extracted so oxlint does not treat StatusBar's style prop as a React Native View style.
const statusBarStyle = "dark" as const

const Navigator = ({ fontsLoaded }: { readonly fontsLoaded: boolean }) => {
  const theme = useTheme()
  const { status, t, retry } = useSession()
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
        <Stack.Screen name="privacy" />
        <Stack.Screen name="terms" />
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="entry/[id]" />
          <Stack.Screen name="sources/[id]" />
          <Stack.Screen name="settings" options={{ presentation: "modal" }} />
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
