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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { setAudioModeAsync } from "expo-audio"
import { FontDisplay, useFonts } from "expo-font"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { Platform } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Button } from "../src/components/Button.tsx"
import { iconFonts } from "../src/components/Icon.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { MascotMessage } from "../src/components/States.tsx"
import { SessionProvider, useSession } from "../src/session/SessionProvider.tsx"
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider.tsx"

SplashScreen.preventAutoHideAsync().catch(() => {})
// Pronunciation should play even when the phone's ring switch is on silent.
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})

// The Japanese faces are several megabytes each. Apps bundle them; the web shows
// the page without waiting and swaps them in as they arrive.
const swap = (uri: number) => ({ uri, display: FontDisplay.SWAP })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } }
})

const Navigator = ({ fontsLoaded }: { readonly fontsLoaded: boolean }) => {
  const { status, t, retry } = useSession()
  const theme = useTheme()
  const ready = fontsLoaded && status !== "loading"

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  if (status === "offline") {
    return (
      <Screen bottomInset={40}>
        <MascotMessage mood="sleepy" title={t.appName} body={t.common.offline} size={140}>
          <Button label={t.common.retry} icon="refresh" onPress={retry} />
        </MascotMessage>
      </Screen>
    )
  }

  return (
    <>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.background } }}>
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="entry/[id]" />
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

export default function RootLayout() {
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
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <Navigator fontsLoaded={fontsLoaded} />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
