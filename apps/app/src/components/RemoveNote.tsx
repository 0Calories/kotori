import { View } from "react-native"
import { ApiError } from "../api/client.ts"
import type { Strings } from "../i18n/strings.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { theme } from "../theme/tokens.ts"
import { Button } from "./Button.tsx"
import { Notice } from "./Notice.tsx"
import { Text } from "./Text.tsx"

/** What to tell the learner when removing a note didn't work. */
export const removalErrorText = (t: Strings, error: unknown): string =>
  error instanceof ApiError && error.tag === "Offline" ? t.common.offline : t.saved.removeFailed

/**
 * Confirmation before a saved note is erased. The API deletes the note, its cards
 * and their review logs together, so the learner has to ask twice.
 */
export const RemoveNoteConfirm = ({
  busy,
  error,
  onConfirm,
  onCancel
}: {
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) => {
  const { t } = useSession()
  return (
    <View style={{ gap: theme.space.md }}>
      <Text variant="strong">{t.saved.removeTitle}</Text>
      <Text variant="small" color="textMuted">
        {t.saved.removeBody}
      </Text>
      <Notice message={error} />
      <Button
        label={busy ? t.saved.removing : t.saved.removeConfirm}
        variant="dark"
        full
        icon="delete"
        loading={busy}
        onPress={onConfirm}
      />
      <View style={{ alignItems: "center" }}>
        <Button label={t.common.cancel} variant="ghost" size="sm" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  )
}
