import type { Language } from "@kotori/domain"
import { useRouter } from "expo-router"
import { useRef, useState } from "react"
import { Platform, type TextInput, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { authMessage } from "../src/auth/messages.ts"
import { Button, IconButton } from "../src/components/Button.tsx"
import { Input } from "../src/components/Input.tsx"
import { LanguageChoice } from "../src/components/LanguageChoice.tsx"
import { Notice } from "../src/components/Notice.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { theme } from "../src/theme/tokens.ts"

/** Better Auth's default minimum; Managed Auth's own answer wins if it differs. */
const MIN_PASSWORD = 8

export default function SignUp() {
  const { t, signUp } = useSession()
  const router = useRouter()
  const [native, setNative] = useState<Language | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailRef = useRef<TextInput>(null)
  const passwordRef = useRef<TextInput>(null)
  const ready = native !== null && email.trim().length > 0 && password.length >= MIN_PASSWORD

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await signUp({ email, password, name, nativeLanguage: native })
    } catch (e) {
      setError(authMessage(t, e))
      setBusy(false)
    }
  }

  return (
    <Screen bottomInset={40}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <IconButton
          icon={Platform.OS === "android" ? "arrow_back" : "arrow_back_ios_new"}
          label={t.auth.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
        />
        <Text variant="title">{t.auth.signUpTitle}</Text>
      </View>
      <Animated.View entering={FadeInDown.duration(400)} style={{ gap: theme.space.md }}>
        <Text variant="label" color="textMuted" style={{ paddingHorizontal: 4 }}>
          {t.onboarding.question.toUpperCase()}
        </Text>
        <LanguageChoice value={native} onChange={setNative} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ gap: theme.space.md }}>
        <Input
          label={t.auth.name}
          placeholder={t.auth.namePlaceholder}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          maxLength={60}
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <Input
          ref={emailRef}
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
          label={`${t.auth.password} · ${t.auth.passwordHint}`}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <Notice message={error} />
        <Button
          label={busy ? t.auth.signingUp : t.auth.signUp}
          size="lg"
          full
          icon="arrow_forward"
          disabled={!ready}
          loading={busy}
          onPress={() => void submit()}
        />
        <Text variant="caption" color="textFaint" align="center">
          {t.auth.beta}
        </Text>
        <View style={{ alignItems: "center" }}>
          <Button label={t.auth.toSignIn} variant="ghost" size="sm" onPress={() => router.replace("/sign-in")} />
        </View>
      </Animated.View>
    </Screen>
  )
}
