import { useRouter } from "expo-router"
import { useRef, useState } from "react"
import { Platform, type TextInput, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { devCredentials } from "../src/auth/dev.ts"
import { authMessage } from "../src/auth/messages.ts"
import { Button, IconButton } from "../src/components/Button.tsx"
import { GoogleButton, OrDivider } from "../src/components/GoogleButton.tsx"
import { Input } from "../src/components/Input.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Notice } from "../src/components/Notice.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { theme } from "../src/theme/tokens.ts"

export default function SignIn() {
  const { t, signIn, signInWithGoogle, googleError } = useSession()
  const router = useRouter()
  const dev = devCredentials()
  const [email, setEmail] = useState(dev?.email ?? "")
  const [password, setPassword] = useState(dev?.password ?? "")
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
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

  const continueWithGoogle = async () => {
    if (busy || googleBusy) return
    setGoogleBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setError(authMessage(t, e))
    }
    setGoogleBusy(false)
  }

  const shown = error ?? (googleError === null ? null : authMessage(t, googleError))

  return (
    <Screen bottomInset={40}>
      <IconButton
        icon={Platform.OS === "android" ? "arrow_back" : "arrow_back_ios_new"}
        label={t.auth.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
      />
      <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", gap: theme.space.sm }}>
        <Mascot size={110} mood="neutral" />
        <Text variant="title" align="center">
          {t.auth.signInTitle}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ gap: theme.space.md }}>
        <GoogleButton
          label={googleBusy ? t.auth.googleOpening : t.auth.google}
          loading={googleBusy}
          disabled={busy}
          onPress={() => void continueWithGoogle()}
        />
        <OrDivider label={t.auth.or} />
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
        <Notice message={shown} />
        <Button
          label={busy ? t.auth.signingIn : t.auth.signIn}
          size="lg"
          full
          icon="arrow_forward"
          disabled={!ready || googleBusy}
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
