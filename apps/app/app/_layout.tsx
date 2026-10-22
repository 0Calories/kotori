import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts
} from "@expo-google-fonts/nunito"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { setAudioModeAsync } from "expo-audio"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Button } from "../src/components/Button.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { MascotMessage } from "../src/components/States.tsx"
import { SessionProvider, useSession } from "../src/session/SessionProvider.tsx"
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider.tsx"

SplashScreen.preventAutoHideAsync()
// Pronunciation should play even when the phone's ring switch is on silent.
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } }
})

const Navigator = ({ fontsLoaded }: { readonly fontsLoaded: boolean }) => {
  const { status, t, retry } = useSession()
  const theme = useTheme()
  const ready = fontsLoaded && status !== "loading"

  useEffect(() => {
    if (ready) SplashScreen.hideAsync()
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
        <Stack.Protected guard={status !== "ready"}>
          <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
        </Stack.Protected>
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold
  })
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <Navigator fontsLoaded={fontsLoaded || fontError !== null} />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
