import { useRouter } from "expo-router"
import { useRef, useState } from "react"
import { Platform, type TextInput, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { authMessage } from "../src/auth/messages.ts"
import { Button, IconButton } from "../src/components/Button.tsx"
import { Input } from "../src/components/Input.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Notice } from "../src/components/Notice.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

export default function SignIn() {
  const { t, signIn } = useSession()
  const theme = useTheme()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<TextInput>(null)
  const ready = email.trim().length > 0 && password.length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      // On success the session moves on, and the navigator with it.
      await signIn(email, password)
    } catch (e) {
      setError(authMessage(t, e))
      setBusy(false)
    }
  }

  return (
    <Screen bottomInset={40}>
      <IconButton
        icon={Platform.OS === "android" ? "arrow_back" : "arrow_back_ios_new"}
        label={t.auth.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
      />
      <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", gap: theme.space.sm }}>
        <Mascot size={110} mood="curious" />
        <Text variant="title" align="center">
          {t.auth.signInTitle}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ gap: theme.space.md }}>
        <Input
          label={t.auth.email}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Input
          ref={passwordRef}
          label={t.auth.password}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <Notice message={error} />
        <Button
          label={busy ? t.auth.signingIn : t.auth.signIn}
          size="lg"
          full
          icon="arrow_forward"
          disabled={!ready}
          loading={busy}
          onPress={() => void submit()}
        />
        <View style={{ alignItems: "center" }}>
          <Button label={t.auth.forgot} variant="ghost" size="sm" onPress={() => router.push("/forgot-password")} />
          <Button label={t.auth.toSignUp} variant="ghost" size="sm" onPress={() => router.replace("/sign-up")} />
        </View>
      </Animated.View>
    </Screen>
  )
}
