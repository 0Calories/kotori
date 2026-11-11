import type { Note } from "@kotori/contracts"
import { Modal, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ApiError } from "../api/client.ts"
import type { Strings } from "../i18n/strings.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade, theme } from "../theme/tokens.ts"
import { Button } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { Headword } from "./Headword.tsx"
import { Notice } from "./Notice.tsx"
import { Text } from "./Text.tsx"

/** What to tell the learner when removing a note didn't work. */
export const removalErrorText = (t: Strings, error: unknown): string =>
  error instanceof ApiError && error.tag === "Offline" ? t.common.offline : t.saved.removeFailed

/**
 * Confirmation before a saved note is erased. The API deletes the note and
 * its review logs together, so the learner has to ask twice.
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

/** A viewport-level confirmation shared by the entry header and its meaning bookmarks. */
export const RemoveNoteDialog = ({
  note,
  busy,
  error,
  onConfirm,
  onCancel
}: {
  readonly note: Note | undefined
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const dismiss = () => {
    if (!busy) onCancel()
  }
  const content = note?.content
  return (
    <Modal visible={note !== undefined} transparent onRequestClose={dismiss}>
      <ScrollView
        style={{ flex: 1, backgroundColor: fade(theme.color.ink, 0.4) }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: theme.space.lg,
          paddingTop: insets.top + theme.space.lg,
          paddingBottom: insets.bottom + theme.space.lg
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card
          accessibilityViewIsModal
          style={{ width: "100%", maxWidth: 420, alignSelf: "center", gap: theme.space.md }}
        >
          {content?.kind === "word" ? (
            <Headword language={content.language ?? "ja"} size={24}>
              {content.headword}
            </Headword>
          ) : content?.kind === "phrase" ? (
            <Text variant="heading">{content.text}</Text>
          ) : null}
          {content ? <Text color="textMuted">{content.meaning}</Text> : null}
          <RemoveNoteConfirm busy={busy} error={error} onConfirm={onConfirm} onCancel={dismiss} />
        </Card>
      </ScrollView>
    </Modal>
  )
}
