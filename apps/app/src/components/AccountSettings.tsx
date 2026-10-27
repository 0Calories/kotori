import { useRef, useState } from "react"
import { type TextInput, View } from "react-native"
import { authMessage } from "../auth/messages.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { theme } from "../theme/tokens.ts"
import { Button } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { Input } from "./Input.tsx"
import { Notice } from "./Notice.tsx"
import { Text } from "./Text.tsx"

/** Better Auth's default minimum; Managed Auth's own answer wins if it differs. */
const MIN_PASSWORD = 8

/** Changing the password from Settings. Signs the learner's other devices out, not this one. */
export const ChangePassword = () => {
  const { t, changePassword } = useSession()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const nextRef = useRef<TextInput>(null)
  const ready = current.length > 0 && next.length >= MIN_PASSWORD

  const close = () => {
    setOpen(false)
    setCurrent("")
    setNext("")
    setError(null)
  }

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await changePassword(current, next)
      close()
      setDone(true)
    } catch (e) {
      setError(authMessage(t, e))
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <View style={{ gap: theme.space.sm }}>
        {done ? <Notice message={t.settings.passwordChanged} tone="primary" /> : null}
        <Button
          label={t.settings.changePassword}
          variant="secondary"
          icon="edit"
          onPress={() => {
            setDone(false)
            setOpen(true)
          }}
        />
      </View>
    )
  }

  return (
    <View style={{ gap: theme.space.md }}>
      <Input
        label={t.settings.currentPassword}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        onSubmitEditing={() => nextRef.current?.focus()}
      />
      <Input
        ref={nextRef}
        label={t.settings.newPassword}
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      <Text variant="caption" color="textFaint" style={{ paddingHorizontal: 4 }}>
        {t.auth.passwordHint}
      </Text>
      <Notice message={error} />
      <Button
        label={busy ? t.settings.changingPassword : t.settings.changePassword}
        full
        icon="check"
        disabled={!ready}
        loading={busy}
        onPress={() => void submit()}
      />
      <View style={{ alignItems: "center" }}>
        <Button label={t.common.cancel} variant="ghost" size="sm" disabled={busy} onPress={close} />
      </View>
    </View>
  )
}

/**
 * Deleting the account, behind a confirmation: the API erases the identity and
 * everything studied in one transaction, and the app lands back on the welcome screen.
 */
export const DeleteAccount = () => {
  const { t, deleteAccount } = useSession()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // On success the session ends and this screen goes with it.
      await deleteAccount()
    } catch (e) {
      setError(authMessage(t, e))
      setBusy(false)
    }
  }

  if (!confirming) {
    return <Button label={t.settings.deleteAccount} variant="ghost" icon="delete" onPress={() => setConfirming(true)} />
  }

  return (
    <Card tone="accent" style={{ gap: theme.space.md }}>
      <Text variant="strong">{t.settings.deleteTitle}</Text>
      <Text variant="small" color="textMuted">
        {t.settings.deleteBody}
      </Text>
      <Notice message={error} />
      <Button
        label={busy ? t.settings.deleting : t.settings.deleteConfirm}
        variant="dark"
        full
        icon="delete"
        loading={busy}
        onPress={() => void submit()}
      />
      <View style={{ alignItems: "center" }}>
        <Button
          label={t.common.cancel}
          variant="ghost"
          size="sm"
          disabled={busy}
          onPress={() => setConfirming(false)}
        />
      </View>
    </Card>
  )
}
