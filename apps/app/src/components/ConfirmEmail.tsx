import { useState } from "react"
import { View } from "react-native"
import { authMessage } from "../auth/messages.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Button } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { Icon } from "./Icon.tsx"
import { Input } from "./Input.tsx"
import { Notice } from "./Notice.tsx"
import { Text } from "./Text.tsx"

/**
 * The six-digit code that confirms the learner's address, with a way to ask for a
 * fresh one. Shown while waiting for approval and again in Settings, since approval
 * doesn't depend on it and an account can arrive in the app unconfirmed.
 */
export const ConfirmEmail = () => {
  const theme = useTheme()
  const { t, profile, verifyEmail, sendVerificationCode } = useSession()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null)
  const [message, setMessage] = useState<{ readonly text: string; readonly ok: boolean } | null>(null)
  if (profile === null) return null

  if (profile.emailVerified) {
    return (
      <Card tone="primary" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name="check_circle" size={20} color={theme.color.primaryDark} />
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
      <Notice message={message?.text ?? null} tone={message?.ok ? "primary" : "accent"} />
      <Button
        label={t.pending.confirm}
        full
        icon="check"
        disabled={code.length !== 6 || busy !== null}
        loading={busy === "verify"}
        onPress={() => void run("verify")}
      />
      <View style={{ alignItems: "center" }}>
        <Button
          label={t.pending.resend}
          variant="ghost"
          size="sm"
          icon="mail"
          disabled={busy !== null}
          loading={busy === "resend"}
          onPress={() => void run("resend")}
        />
      </View>
    </Card>
  )
}
