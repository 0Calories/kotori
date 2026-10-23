import Ionicons from "@expo/vector-icons/Ionicons"
import { useEffect, useState } from "react"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { authMessage } from "../src/auth/messages.ts"
import { Button } from "../src/components/Button.tsx"
import { Card } from "../src/components/Card.tsx"
import { Input } from "../src/components/Input.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Notice } from "../src/components/Notice.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

/** How often the screen checks whether the admin has approved the account. */
const POLL_MS = 30_000

const ConfirmEmail = () => {
  const { t, profile, verifyEmail, sendVerificationCode } = useSession()
  const theme = useTheme()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null)
  const [message, setMessage] = useState<{ readonly text: string; readonly ok: boolean } | null>(null)
  if (profile === null) return null

  if (profile.emailVerified) {
    return (
      <Card tone="matcha" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Ionicons name="checkmark-circle" size={20} color={theme.color.matcha} />
        <Text variant="strong">{t.pending.confirmed}</Text>
      </Card>
    )
  }

  const run = async (action: "verify" | "resend") => {
    setBusy(action)
    setMessage(null)
    try {
      if (action === "verify") await verifyEmail(code)
      else {
        await sendVerificationCode()
        setMessage({ text: t.pending.resent, ok: true })
      }
    } catch (e) {
      setMessage({ text: authMessage(t, e), ok: false })
    }
    setBusy(null)
  }

  return (
    <Card style={{ gap: theme.space.md }}>
      <Text variant="label" color="textMuted">
        {t.pending.confirmTitle.toUpperCase()}
      </Text>
      <Text variant="small" color="textMuted">
        {t.pending.confirmBody(profile.email)}
      </Text>
      <Input
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        style={{ fontSize: 24, letterSpacing: 8, textAlign: "center" }}
        accessibilityLabel={t.pending.confirmTitle}
        onSubmitEditing={() => void run("verify")}
      />
      <Notice message={message?.text ?? null} tone={message?.ok ? "matcha" : "plum"} />
      <Button
        label={t.pending.confirm}
        full
        icon="checkmark"
        disabled={code.length !== 6 || busy !== null}
        loading={busy === "verify"}
        onPress={() => void run("verify")}
      />
      <View style={{ alignItems: "center" }}>
        <Button
          label={t.pending.resend}
          variant="ghost"
          size="sm"
          icon="mail-outline"
          disabled={busy !== null}
          loading={busy === "resend"}
          onPress={() => void run("resend")}
        />
      </View>
    </Card>
  )
}

export default function Pending() {
  const { t, refresh, signOut } = useSession()
  const theme = useTheme()

  // Approval happens in the admin's CLI; check back now and then, and move on when it lands.
  useEffect(() => {
    const timer = setInterval(() => void refresh().catch(() => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <Screen bottomInset={40}>
      <Animated.View
        entering={FadeInDown.duration(500)}
        style={{ alignItems: "center", gap: theme.space.md, marginTop: theme.space.xl }}
      >
        <Mascot size={150} mood="sleepy" />
        <Text variant="title" align="center">
          {t.pending.title}
        </Text>
        <Text color="textMuted" align="center" style={{ maxWidth: 360 }}>
          {t.pending.body}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(150).duration(500)} style={{ gap: theme.space.lg }}>
        <ConfirmEmail />
        <Button label={t.pending.signOut} variant="secondary" icon="log-out-outline" onPress={() => void signOut()} />
      </Animated.View>
    </Screen>
  )
}
