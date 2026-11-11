import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { type TextInput, View } from "react-native"
import { managedAuth } from "../auth/client.ts"
import { google } from "../auth/google"
import { authMessage } from "../auth/messages.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { theme } from "../theme/tokens.ts"
import { Button } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { GoogleButton, GoogleMark } from "./GoogleButton.tsx"
import { Input } from "./Input.tsx"
import { Notice } from "./Notice.tsx"
import { Text } from "./Text.tsx"

/** Better Auth's default minimum; Managed Auth's own answer wins if it differs. */
const MIN_PASSWORD = 8

const ACCOUNTS_KEY = ["auth", "accounts"] as const

/** The sign-in methods attached to the learner's account (`"credential"`, `"google"`, …). */
const useAccounts = () =>
  useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => managedAuth.listAccounts()
  })

/**
 * Attaching Google to an existing account from Settings, so a learner who signed up
 * with a password can use Google from then on. Once Google is attached (or if they
 * signed up with Google to begin with), shows that it's connected instead.
 */
export const GoogleAccount = () => {
  const { t } = useSession()
  const queryClient = useQueryClient()
  const accounts = useAccounts()
  const [busy, setBusy] = useState(false)
  const [justLinked, setJustLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const back = google.linkReturned()
      if (back === null) return
      if (back.verifier !== null) void managedAuth.finishGoogle(back.verifier).catch(() => {})
      setJustLinked(true)
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    } catch (e) {
      setError(authMessage(t, e))
    }
  }, [queryClient, t])

  const connect = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const back = await google.link()
      if (back === "redirected") return
      if (back !== null) {
        if (back.verifier !== null) await managedAuth.finishGoogle(back.verifier).catch(() => {})
        setJustLinked(true)
        await queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      }
    } catch (e) {
      setError(authMessage(t, e))
    }
    setBusy(false)
  }

  const linked = justLinked || accounts.data?.some((a) => a.providerId === "google") === true

  if (linked) {
    return (
      <View style={{ gap: theme.space.sm }}>
        {justLinked ? <Notice message={t.settings.googleLinked} tone="primary" /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <GoogleMark size={16} />
          <Text variant="small" color="textMuted">
            {t.settings.googleConnected}
          </Text>
        </View>
      </View>
    )
  }

  if (accounts.data === undefined && error === null) return null

  return (
    <View style={{ gap: theme.space.sm }}>
      <Notice message={error} />
      <GoogleButton
        label={busy ? t.auth.googleOpening : t.settings.connectGoogle}
        loading={busy}
        onPress={() => void connect()}
      />
    </View>
  )
}

/** Changing the password from Settings. Signs the learner's other devices out, not this one. */
export const ChangePassword = () => {
  const { t, changePassword } = useSession()
  const accounts = useAccounts()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const nextRef = useRef<TextInput>(null)
  const ready = current.length > 0 && next.length >= MIN_PASSWORD

  // A learner who signed up with Google has no password to change.
  if (accounts.data !== undefined && !accounts.data.some((a) => a.providerId === "credential")) return null

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
