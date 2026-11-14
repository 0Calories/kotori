import type { Note, SenseLayout } from "@kotori/contracts"
import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { View } from "react-native"
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated"
import { ApiError } from "../src/api/client.ts"
import { useArrangeNote, useNotes, useRemoveNote } from "../src/api/queries.ts"
import { Button, IconButton } from "../src/components/Button.tsx"
import { Card } from "../src/components/Card.tsx"
import { Chip } from "../src/components/Chip.tsx"
import { Headword } from "../src/components/Headword.tsx"
import { Notice } from "../src/components/Notice.tsx"
import { PressableScale } from "../src/components/PressableScale.tsx"
import { removalErrorText, RemoveNoteConfirm } from "../src/components/RemoveNote.tsx"
import { Header, Screen } from "../src/components/Screen.tsx"
import { SearchField } from "../src/components/SearchField.tsx"
import { ErrorState, MascotMessage } from "../src/components/States.tsx"
import { Text } from "../src/components/Text.tsx"
import { searchNotes } from "../src/lib/noteSearch.ts"
import { reviewMark } from "../src/lib/entry.ts"
import { choicesOf, glossLine, layoutOf, moveChoice, noteMeaning, shownSenses, toggleChoice } from "../src/lib/notes.ts"
import { useReadingPhase } from "../src/lib/readingPhase.ts"
import { useSession } from "../src/session/SessionProvider.tsx"
import { theme } from "../src/theme/tokens.ts"

/**
 * Choosing the meanings a note shows: each sense can be shown or hidden, and shown ones moved up
 * or down; the note keeps at least one. Nothing is saved until "Done".
 */
const SenseEditor = ({ note, onClose }: { readonly note: Note; readonly onClose: () => void }) => {
  const { t } = useSession()
  const arrange = useArrangeNote()
  const [choices, setChoices] = useState(() => choicesOf(note))
  const [error, setError] = useState<string | null>(null)
  const glosses = new Map(note.senses.map((sense) => [sense.index, sense.glosses]))
  const shownCount = choices.filter((choice) => choice.shown).length

  const save = async (layout: SenseLayout) => {
    setError(null)
    // Unchanged: nothing to send.
    const before = note.arranged ? shownSenses(note).map((sense) => sense.index) : null
    if (JSON.stringify(layout) === JSON.stringify(before)) return onClose()
    try {
      await arrange.mutateAsync({ id: note.id, senses: layout })
      onClose()
    } catch (caught) {
      setError(caught instanceof ApiError && caught.tag === "Offline" ? t.common.offline : t.saved.arrangeFailed)
    }
  }

  return (
    <View style={{ gap: theme.space.md }}>
      <Text variant="small" color="textMuted">
        {t.saved.arrangeHint}
      </Text>
      <View style={{ gap: 4 }}>
        {choices.map((choice, position) => {
          const last = choice.shown && shownCount === 1
          return (
            <View key={choice.index} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <IconButton
                icon={choice.shown ? "check_circle" : "radio_button_unchecked"}
                filled={choice.shown}
                size={40}
                label={choice.shown ? t.saved.hide : t.saved.show}
                onPress={last ? undefined : () => setChoices(toggleChoice(choices, choice.index))}
              />
              <Text style={{ flex: 1 }} color={choice.shown ? "text" : "textFaint"} numberOfLines={2}>
                {glossLine(note.entry.language, glosses.get(choice.index) ?? [])}
              </Text>
              {choice.shown ? (
                <>
                  <IconButton
                    icon="expand_less"
                    size={36}
                    label={t.saved.moveUp}
                    onPress={position === 0 ? undefined : () => setChoices(moveChoice(choices, choice.index, -1))}
                  />
                  <IconButton
                    icon="expand_more"
                    size={36}
                    label={t.saved.moveDown}
                    onPress={
                      position === shownCount - 1 ? undefined : () => setChoices(moveChoice(choices, choice.index, 1))
                    }
                  />
                </>
              ) : null}
            </View>
          )
        })}
      </View>
      {shownCount === 1 && choices.length > 1 ? (
        <Text variant="caption" color="textFaint">
          {t.saved.lastSense}
        </Text>
      ) : null}
      <Notice message={error} />
      <Button
        label={t.saved.done}
        variant="dark"
        full
        icon="check"
        loading={arrange.isPending}
        onPress={() => void save(layoutOf(choices))}
      />
      <View style={{ flexDirection: "row", justifyContent: "center", gap: theme.space.sm }}>
        {choices.length > 1 ? (
          <Button
            label={t.saved.showAll}
            variant="ghost"
            size="sm"
            disabled={arrange.isPending}
            onPress={() => void save(null)}
          />
        ) : null}
        <Button label={t.common.cancel} variant="ghost" size="sm" disabled={arrange.isPending} onPress={onClose} />
      </View>
    </View>
  )
}

const NoteRow = ({ note }: { readonly note: Note }) => {
  const router = useRouter()
  const { t } = useSession()
  const remove = useRemoveNote()
  const [mode, setMode] = useState<"row" | "arranging" | "confirming">("row")
  const [error, setError] = useState<string | null>(null)
  const { entry } = note
  const learning = note.retentionStage !== "new"
  const leech = note.leech
  const hidden = note.senses.length - shownSenses(note).length
  const mark = reviewMark(t, entry.review)

  const confirm = async () => {
    setError(null)
    try {
      await remove.mutateAsync(note.id)
    } catch (caught) {
      setError(removalErrorText(t, caught))
    }
  }

  const headword = (
    <Headword language={entry.language} size={entry.language === "en" ? 21 : 24} style={{ lineHeight: 30 }}>
      {entry.headword}
    </Headword>
  )

  return (
    <Animated.View exiting={FadeOut.duration(180)} layout={LinearTransition.duration(200)}>
      <Card style={mode === "row" ? { flexDirection: "row", alignItems: "center", gap: 12 } : { gap: theme.space.md }}>
        {mode === "confirming" ? (
          <>
            {headword}
            <RemoveNoteConfirm
              busy={remove.isPending}
              error={error}
              onConfirm={() => void confirm()}
              onCancel={() => {
                if (remove.isPending) return
                setMode("row")
                setError(null)
              }}
            />
          </>
        ) : mode === "arranging" ? (
          <>
            {headword}
            <SenseEditor note={note} onClose={() => setMode("row")} />
          </>
        ) : (
          <>
            <PressableScale
              scaleTo={0.985}
              onPress={() => router.push({ pathname: "/entry/[id]", params: { id: String(entry.id) } })}
              style={{ flex: 1, gap: 4 }}
            >
              {headword}
              <Text variant="small" color="textMuted" numberOfLines={2}>
                {noteMeaning(note)}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Chip tone={learning ? "primary" : "neutral"} label={learning ? t.review.learning : t.review.new} />
                {leech ? <Chip tone="accent" icon="error" label="leech" /> : null}
                {mark === null ? null : <Chip {...mark.chip} />}
                {hidden > 0 ? <Chip tone="neutral" label={t.saved.hidden(hidden)} /> : null}
              </View>
            </PressableScale>
            {note.senses.length > 1 ? (
              <IconButton icon="edit" label={t.saved.arrange} size={40} onPress={() => setMode("arranging")} />
            ) : null}
            <IconButton icon="delete" label={t.saved.remove} size={40} onPress={() => setMode("confirming")} />
          </>
        )}
      </Card>
    </Animated.View>
  )
}

export default function SavedScreen() {
  const router = useRouter()
  const { t } = useSession()
  const notes = useNotes()
  const [query, setQuery] = useState("")
  const kotoriReading = useReadingPhase(!notes.data && !notes.isError) === "reading"
  const hasNotes = (notes.data?.length ?? 0) > 0
  const searching = hasNotes && query.trim().length > 0
  // Every saved note is loaded, so the search runs here. With no notes left (the last one removed
  // mid-search, say), a lingering query is ignored.
  const found = useMemo(() => searchNotes(notes.data ?? [], hasNotes ? query : ""), [notes.data, query, hasNotes])
  const shown = found.notes

  return (
    <Screen
      bottomInset={40}
      header={<Header onBack={() => (router.canGoBack() ? router.back() : router.replace("/review"))} />}
    >
      <Text variant="title" accessibilityRole="header" style={{ paddingHorizontal: 2 }}>
        {t.saved.title}
      </Text>
      {hasNotes ? <SearchField size="md" value={query} onChangeText={setQuery} placeholder={t.saved.search} /> : null}
      {notes.isError ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : null}
      {kotoriReading ? <MascotMessage mood="reading" /> : null}
      {notes.data && !kotoriReading && shown.length === 0 ? (
        <MascotMessage
          mood="neutral"
          facing="front"
          body={searching ? t.saved.noMatches(query.trim()) : t.review.empty}
        />
      ) : null}
      {searching && found.match === "weak" && shown.length > 0 ? (
        // Only lookalikes: said plainly, as the dictionary does.
        <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 6 }}>
          {t.saved.similar}
        </Text>
      ) : null}
      <View style={{ gap: theme.space.md }}>
        {kotoriReading ? null : shown.map((note) => <NoteRow key={note.id} note={note} />)}
      </View>
    </Screen>
  )
}
