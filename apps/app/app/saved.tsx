import type { Note } from "@kotori/contracts"
import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { View } from "react-native"
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated"
import { useNotes, useRemoveNote } from "../src/api/queries.ts"
import { IconButton } from "../src/components/Button.tsx"
import { Card } from "../src/components/Card.tsx"
import { Chip } from "../src/components/Chip.tsx"
import { Headword } from "../src/components/Headword.tsx"
import { PressableScale } from "../src/components/PressableScale.tsx"
import { removalErrorText, RemoveNoteConfirm } from "../src/components/RemoveNote.tsx"
import { Header, Screen } from "../src/components/Screen.tsx"
import { SearchField } from "../src/components/SearchField.tsx"
import { Segmented } from "../src/components/Segmented.tsx"
import { ErrorState, MascotMessage } from "../src/components/States.tsx"
import { Text } from "../src/components/Text.tsx"
import { searchNotes } from "../src/lib/noteSearch.ts"
import { useSession } from "../src/session/SessionProvider.tsx"
import { theme } from "../src/theme/tokens.ts"

const NoteRow = ({ note }: { readonly note: Note }) => {
  const router = useRouter()
  const { t } = useSession()
  const remove = useRemoveNote()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const content = note.content
  const learning = note.cards.some((card) => card.queue !== "new")
  const leech = note.cards.some((card) => card.leech)

  const confirm = async () => {
    setError(null)
    try {
      await remove.mutateAsync(note.id)
    } catch (caught) {
      setError(removalErrorText(t, caught))
    }
  }

  return (
    <Animated.View exiting={FadeOut.duration(180)} layout={LinearTransition.duration(200)}>
      <Card style={confirming ? { gap: theme.space.md } : { flexDirection: "row", alignItems: "center", gap: 12 }}>
        {confirming ? (
          <>
            {content.kind === "word" ? (
              <Headword language={content.language ?? "ja"} size={content.language === "en" ? 21 : 24}>
                {content.headword}
              </Headword>
            ) : (
              <Text variant="heading">{content.text}</Text>
            )}
            <RemoveNoteConfirm
              busy={remove.isPending}
              error={error}
              onConfirm={() => void confirm()}
              onCancel={() => {
                if (remove.isPending) return
                setConfirming(false)
                setError(null)
              }}
            />
          </>
        ) : (
          <>
            <PressableScale
              scaleTo={0.985}
              disabled={content.kind !== "word"}
              onPress={() =>
                content.kind === "word" &&
                router.push({ pathname: "/entry/[id]", params: { id: String(content.entryId) } })
              }
              style={{ flex: 1, gap: 4 }}
            >
              {content.kind === "word" ? (
                <Headword
                  language={content.language ?? "ja"}
                  size={content.language === "en" ? 21 : 24}
                  style={{ lineHeight: 30 }}
                >
                  {content.headword}
                </Headword>
              ) : (
                <Text variant="heading">{content.text}</Text>
              )}
              <Text variant="small" color="textMuted" numberOfLines={2}>
                {content.meaning}
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Chip tone={learning ? "primary" : "neutral"} label={learning ? t.review.learning : t.review.new} />
                {leech ? <Chip tone="accent" icon="error" label="leech" /> : null}
              </View>
            </PressableScale>
            <IconButton icon="delete" label={t.saved.remove} size={40} onPress={() => setConfirming(true)} />
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
  const [kind, setKind] = useState<"word" | "phrase">("word")
  const [query, setQuery] = useState("")
  const searching = query.trim().length > 0
  // Every saved note is loaded, so the search runs here, as the notes are typed for.
  const found = useMemo(() => searchNotes(notes.data ?? [], query), [notes.data, query])
  const ofKind = (which: "word" | "phrase") => found.notes.filter((note) => note.content.kind === which)
  const shown = ofKind(kind)
  const label = (which: "word" | "phrase", text: string) => (searching ? `${text} · ${ofKind(which).length}` : text)

  return (
    <Screen
      bottomInset={40}
      header={<Header onBack={() => (router.canGoBack() ? router.back() : router.replace("/review"))} />}
    >
      <Text variant="title" accessibilityRole="header" style={{ paddingHorizontal: 2 }}>
        {t.saved.title}
      </Text>
      {notes.data && notes.data.length > 0 ? (
        <SearchField size="md" value={query} onChangeText={setQuery} placeholder={t.saved.search} />
      ) : null}
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "word", label: label("word", t.saved.words) },
          { value: "phrase", label: label("phrase", t.saved.phrases) }
        ]}
      />
      {notes.isError ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : null}
      {notes.data && shown.length === 0 ? (
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
        {shown.map((note) => (
          <NoteRow key={note.id} note={note} />
        ))}
      </View>
    </Screen>
  )
}
