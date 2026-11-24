import type { Note } from "@kotori/contracts"
import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { RefreshControl, View } from "react-native"
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated"
import { useNotes, useRemoveNote } from "../../src/api/queries.ts"
import { IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { Notice } from "../../src/components/Notice.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen } from "../../src/components/Screen.tsx"
import { SearchField } from "../../src/components/SearchField.tsx"
import { SkeletonGroup, SkeletonRows } from "../../src/components/Skeleton.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { reviewStateChip } from "../../src/lib/entry.ts"
import { searchNotes } from "../../src/lib/noteSearch.ts"
import { noteErrorText, noteGlosses } from "../../src/lib/notes.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const NoteRow = ({ note, onError }: { readonly note: Note; readonly onError: (message: string | null) => void }) => {
  const router = useRouter()
  const { t } = useSession()
  const remove = useRemoveNote()
  const { entry } = note
  const reviewChip = reviewStateChip(t, entry)

  const handleRemove = async () => {
    onError(null)
    try {
      await remove.mutateAsync(note.id)
    } catch (caught) {
      onError(noteErrorText(t, caught, "remove"))
    }
  }

  return (
    <Animated.View exiting={FadeOut.duration(180)} layout={LinearTransition.duration(200)}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <PressableScale
          scaleTo={0.985}
          accessibilityRole="link"
          accessibilityLabel={`${entry.headword}, ${noteGlosses(note)}`}
          onPress={() => router.push({ pathname: "/entry/[id]", params: { id: String(entry.id) } })}
          style={{ flex: 1, gap: 4 }}
        >
          <Headword language={entry.language} size={entry.language === "en" ? 21 : 24} style={{ lineHeight: 30 }}>
            {entry.headword}
          </Headword>
          <Text variant="small" color="textMuted" numberOfLines={2}>
            {noteGlosses(note)}
          </Text>
          {reviewChip === null ? null : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
              <Chip tone="accent" icon={reviewChip.icon} label={reviewChip.label} />
            </View>
          )}
        </PressableScale>
        <IconButton
          icon="delete"
          label={t.notebook.remove}
          size={40}
          onPress={remove.isPending ? undefined : () => void handleRemove()}
        />
      </Card>
    </Animated.View>
  )
}

export default function NotebookScreen() {
  const theme = useTheme()
  const { t } = useSession()
  const notes = useNotes()
  const [query, setQuery] = useState("")
  const [removeError, setRemoveError] = useState<string | null>(null)
  const hasNotes = (notes.data?.length ?? 0) > 0
  const searching = hasNotes && query.trim().length > 0
  const found = useMemo(() => searchNotes(notes.data ?? [], hasNotes ? query : ""), [notes.data, query, hasNotes])
  const shown = found.notes

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={notes.isRefetching}
          onRefresh={() => {
            setRemoveError(null)
            void notes.refetch()
          }}
        />
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Mascot size={56} mood="happy" facing="right" />
        <View style={{ flex: 1 }}>
          <Text variant="title" accessibilityRole="header">
            {t.notebook.title}
          </Text>
          <Text variant="small" color="textMuted">
            {t.notebook.subtitle}
          </Text>
        </View>
      </View>

      {hasNotes ? (
        <SearchField size="md" value={query} onChangeText={setQuery} placeholder={t.notebook.search} />
      ) : null}
      <Notice message={removeError} />
      {notes.isError ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : null}
      {notes.isPending ? (
        <SkeletonGroup>
          <SkeletonRows rows={3} />
        </SkeletonGroup>
      ) : null}
      {notes.data && shown.length === 0 ? (
        <MascotMessage
          mood="neutral"
          facing="front"
          body={searching ? t.notebook.noMatches(query.trim()) : t.notebook.empty}
        />
      ) : null}
      {searching && found.match === "weak" && shown.length > 0 ? (
        <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 6 }}>
          {t.notebook.similar}
        </Text>
      ) : null}
      <View style={{ gap: theme.space.md }}>
        {shown.map((note) => (
          <NoteRow key={note.id} note={note} onError={setRemoveError} />
        ))}
      </View>
    </Screen>
  )
}
