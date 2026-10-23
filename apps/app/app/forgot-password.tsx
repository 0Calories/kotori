import { useRouter } from "expo-router"
import { useRef, useState } from "react"
import { Platform, type TextInput, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { managedAuth } from "../src/auth/client.ts"
import { authMessage } from "../src/auth/messages.ts"
import { Button, IconButton } from "../src/components/Button.tsx"
import { Input } from "../src/components/Input.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Notice } from "../src/components/Notice.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

/** Better Auth's default minimum; Managed Auth's own answer wins if it differs. */
const MIN_PASSWORD = 8

/**
 * Resetting a forgotten password: ask for a code by email, then set a new one with it.
 * The reset doesn't sign anyone in, so it ends at the sign-in screen.
 */
export default function ForgotPassword() {
  const { t } = useSession()
  const theme = useTheme()
  const router = useRouter()
  const [step, setStep] = useState<"email" | "reset" | "done">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<TextInput>(null)
  const address = email.trim()

  const toSignIn = () => router.replace("/sign-in")

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(authMessage(t, e))
    }
    setBusy(false)
  }

  const sendCode = () =>
    run(async () => {
      await managedAuth.sendPasswordResetCode(address)
      setStep("reset")
    })

  const reset = () =>
    run(async () => {
      await managedAuth.resetPassword(address, code, password)
      setStep("done")
    })

  return (
    <Screen bottomInset={40}>
      <IconButton
        icon={Platform.OS === "android" ? "arrow_back" : "arrow_back_ios_new"}
        label={t.auth.back}
        onPress={() => (router.canGoBack() ? router.back() : toSignIn())}
      />
      <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", gap: theme.space.sm }}>
        <Mascot size={110} mood={step === "done" ? "happy" : "curious"} />
        <Text variant="title" align="center">
          {t.auth.forgotTitle}
        </Text>
        {step !== "done" ? (
          <Text color="textMuted" align="center" style={{ maxWidth: 360 }}>
            {step === "email" ? t.auth.forgotBody : t.auth.codeSentBody(address)}
          </Text>
        ) : null}
      </Animated.View>

      {step === "done" ? (
        <Animated.View entering={FadeInDown.duration(400)} style={{ gap: theme.space.md }}>
          <Notice message={t.auth.passwordReset} tone="primary" />
          <Button label={t.auth.signIn} size="lg" full icon="arrow_forward" onPress={toSignIn} />
        </Animated.View>
      ) : (
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ gap: theme.space.md }}>
          {step === "email" ? (
            <>
              <Input
                label={t.auth.email}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="go"
                onSubmitEditing={() => void sendCode()}
              />
              <Notice message={error} />
              <Button
                label={busy ? t.auth.sendingCode : t.auth.sendCode}
                size="lg"
                full
                icon="mail"
                disabled={address.length === 0}
                loading={busy}
                onPress={() => void sendCode()}
              />
            </>
          ) : (
            <>
              <Input
                label={t.auth.code}
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                style={{ fontSize: 24, letterSpacing: 8, textAlign: "center" }}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Input
                ref={passwordRef}
                label={t.auth.newPassword}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={() => void reset()}
              />
              <Text variant="caption" color="textFaint" style={{ paddingHorizontal: 4 }}>
                {t.auth.passwordHint}
              </Text>
              <Notice message={error} />
              <Button
                label={busy ? t.auth.resettingPassword : t.auth.resetPassword}
                size="lg"
                full
                icon="check"
                disabled={code.length !== 6 || password.length < MIN_PASSWORD}
                loading={busy}
                onPress={() => void reset()}
              />
              <View style={{ alignItems: "center" }}>
                <Button
                  label={t.pending.resend}
                  variant="ghost"
                  size="sm"
                  icon="mail"
                  disabled={busy}
                  onPress={() => void sendCode()}
                />
              </View>
            </>
          )}
          <View style={{ alignItems: "center" }}>
            <Button label={t.auth.toSignInFromReset} variant="ghost" size="sm" onPress={toSignIn} />
          </View>
        </Animated.View>
      )}
    </Screen>
  )
}
