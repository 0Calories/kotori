import type { Note } from "@kotori/domain"
import { useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated"
import { useNotes, useRemoveNote } from "../src/api/queries.ts"
import { IconButton } from "../src/components/Button.tsx"
import { Card } from "../src/components/Card.tsx"
import { Chip } from "../src/components/Chip.tsx"
import { PressableScale } from "../src/components/PressableScale.tsx"
import { Screen } from "../src/components/Screen.tsx"
import { Segmented } from "../src/components/Segmented.tsx"
import { ErrorState, MascotMessage } from "../src/components/States.tsx"
import { Text } from "../src/components/Text.tsx"
import { useSession } from "../src/session/SessionProvider.tsx"
import { useTheme } from "../src/theme/ThemeProvider.tsx"

const NoteRow = ({ note }: { readonly note: Note }) => {
  const theme = useTheme()
  const router = useRouter()
  const { t } = useSession()
  const remove = useRemoveNote()
  const content = note.content
  const learning = note.cards.some((card) => card.queue !== "new")
  const leech = note.cards.some((card) => card.leech)
  return (
    <Animated.View exiting={FadeOut.duration(180)} layout={LinearTransition.duration(200)}>
      <PressableScale
        scaleTo={0.985}
        disabled={content.kind !== "word"}
        onPress={() => content.kind === "word" && router.push({ pathname: "/entry/[id]", params: { id: String(content.entryId) } })}
      >
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text jp variant="heading">{content.kind === "word" ? content.headword : content.text}</Text>
            <Text variant="small" color="textMuted" numberOfLines={2}>{content.meaning}</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Chip tone={learning ? "matcha" : "sky"} label={learning ? t.review.learning : t.review.new} />
              {leech ? <Chip tone="yuzu" icon="alert-circle" label="leech" /> : null}
            </View>
          </View>
          <IconButton icon="trash-outline" label={t.saved.remove} size={36} onPress={() => remove.mutate(note.id)} />
        </Card>
      </PressableScale>
    </Animated.View>
  )
}

export default function SavedScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { t } = useSession()
  const notes = useNotes()
  const [kind, setKind] = useState<"word" | "phrase">("word")
  const shown = (notes.data ?? []).filter((note) => note.content.kind === kind)

  return (
    <Screen bottomInset={40}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <IconButton icon="chevron-back" label={t.common.close} onPress={() => (router.canGoBack() ? router.back() : router.replace("/review"))} />
        <Text variant="title">{t.saved.title}</Text>
      </View>
      <Segmented value={kind} onChange={setKind} options={[{ value: "word", label: t.saved.words }, { value: "phrase", label: t.saved.phrases }]} />
      {notes.isError ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : null}
      {notes.data && shown.length === 0 ? <MascotMessage mood="curious" body={t.review.empty} /> : null}
      <View style={{ gap: theme.space.md }}>
        {shown.map((note) => <NoteRow key={note.id} note={note} />)}
      </View>
    </Screen>
  )
}
