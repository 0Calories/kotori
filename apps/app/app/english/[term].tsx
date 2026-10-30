import type { EnglishMeaning } from "@kotori/domain"
import { useLocalSearchParams, useRouter } from "expo-router"
import { View } from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useAddNote, useEnglish, useNotes } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { EnglishNuanceNotes } from "../../src/components/EnglishNuanceNotes.tsx"
import { ExampleRow } from "../../src/components/ExampleRow.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Header, Screen, Section } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { posLabel } from "../../src/i18n/strings.ts"
import { wordNote } from "../../src/lib/notes.ts"
import { formalityTone } from "../../src/lib/tones.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { theme } from "../../src/theme/tokens.ts"

/** A term as large as fits: 52pt for a short word, smaller for a phrase. */
const termSize = (term: string) => (term.length <= 8 ? 52 : Math.max(30, Math.floor(420 / term.length)))

/** One Japanese word that means the English term: the word, its other English glosses, and examples. */
const MeaningCard = ({
  meaning,
  number,
  saved,
  saving,
  onSave
}: {
  readonly meaning: EnglishMeaning
  readonly number: number
  readonly saved: boolean
  readonly saving: boolean
  readonly onSave: () => void
}) => {
  const { t } = useSession()
  const router = useRouter()
  const pos = posLabel(t, meaning.partOfSpeech)
  const also = meaning.glosses.filter((_, index) => index !== meaning.matched)
  const open = () => router.push({ pathname: "/entry/[id]", params: { id: String(meaning.entryId) } })

  return (
    <Card style={{ flexDirection: "row", gap: 12, paddingBottom: 12 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: number === 1 ? theme.color.primaryDark : theme.color.primaryTint,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Text
          variant="caption"
          weight="bold"
          size={13}
          style={{ color: number === 1 ? theme.color.onPrimaryDark : theme.color.text, lineHeight: 16 }}
        >
          {number}
        </Text>
      </View>
      <View style={{ flex: 1, gap: theme.space.sm + 2 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <PressableScale
            onPress={open}
            scaleTo={0.98}
            accessibilityRole="link"
            accessibilityLabel={`${meaning.headword}, ${t.english.open}`}
            style={{ flex: 1, gap: 2 }}
          >
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Text mincho size={26} style={{ lineHeight: 32 }} selectable>
                {meaning.headword}
              </Text>
              {meaning.reading !== meaning.headword ? (
                <Text jp variant="small" color="textMuted">
                  {meaning.reading}
                </Text>
              ) : null}
              <Icon name="chevron_right" size={18} color={theme.color.textMuted} />
            </View>
            {also.length > 0 ? (
              <Text variant="small" color="textMuted">
                {`${t.english.also}: ${also.join("; ")}`}
              </Text>
            ) : null}
          </PressableScale>
          <View style={{ marginTop: -6, marginRight: -8 }}>
            <IconButton
              icon="bookmark"
              filled={saved}
              size={40}
              label={saved ? t.entry.saved : t.entry.save}
              onPress={saved || saving ? undefined : onSave}
            />
          </View>
        </View>
        {meaning.common || pos || (meaning.formality && meaning.formality !== "neutral") ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {meaning.common ? <Chip label={t.dictionary.common} /> : null}
            {pos ? <Chip label={pos} /> : null}
            {meaning.formality && meaning.formality !== "neutral" ? (
              <Chip tone={formalityTone[meaning.formality]} label={t.nuance.scale[meaning.formality]} />
            ) : null}
          </View>
        ) : null}
        {meaning.english ? (
          <EnglishNuanceNotes english={meaning.english} word={[meaning.headword, meaning.reading]} />
        ) : null}
        {/* The audience here is Japanese natives, so the sense note is the Japanese one. */}
        {meaning.noteJa ? (
          <Text jp variant="small" color="textMuted">
            {meaning.noteJa}
          </Text>
        ) : null}
        {meaning.examples.map((example) => (
          <ExampleRow key={example.id} example={example} />
        ))}
      </View>
    </Card>
  )
}

/** An English word or phrase for Japanese speakers: said aloud, then the Japanese words that mean it. */
export default function EnglishScreen() {
  const { t } = useSession()
  const router = useRouter()
  const { term: param } = useLocalSearchParams<{ term: string }>()
  const english = useEnglish(param ?? "")
  const notes = useNotes()
  const addNote = useAddNote()
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"))

  if (english.isError) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <ErrorState error={english.error} onRetry={() => english.refetch()} />
      </Screen>
    )
  }
  if (!english.data) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <MascotMessage mood="thinking" />
      </Screen>
    )
  }

  const { term, meanings, writing } = english.data
  const saved = new Set(
    (notes.data ?? []).flatMap((note) =>
      note.content.kind === "word" ? [`${note.content.entryId}:${note.content.senseIndex}`] : []
    )
  )
  const save = (meaning: EnglishMeaning) =>
    addNote.mutate({
      content: wordNote(t, {
        entryId: meaning.entryId,
        sense: meaning.sense,
        headword: meaning.headword,
        reading: meaning.reading,
        glosses: meaning.glosses,
        formality: meaning.formality,
        medium: null,
        note: meaning.noteJa,
        example: meaning.examples[0],
        audioUrl: null
      })
    })
  const size = termSize(term)

  return (
    <Screen bottomInset={40} header={<Header onBack={back} />}>
      <Animated.View
        entering={FadeInDown.duration(350)}
        style={{
          borderRadius: theme.radius.xl,
          overflow: "hidden",
          backgroundColor: theme.color.primaryTint,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 18
        }}
      >
        <Snow />
        <Text variant="caption" size={14} color="textMuted">
          {t.english.label}
        </Text>
        <Text
          variant="display"
          size={size}
          style={{ lineHeight: Math.round(size * 1.15), marginTop: 4 }}
          selectable
          accessibilityRole="header"
        >
          {term}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, minHeight: 44 }}>
          <AudioButton speak={{ text: term, language: "en" }} label={t.common.listen} />
        </View>
      </Animated.View>

      {writing ? (
        <Animated.View entering={FadeIn}>
          <Card tone="primary" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Mascot size={52} mood="thinking" />
            <Text variant="small" style={{ flex: 1 }}>
              {t.english.writing}
            </Text>
          </Card>
        </Animated.View>
      ) : null}

      {meanings.length === 0 ? (
        <MascotMessage mood="oops" body={t.english.none} size={90} />
      ) : (
        <Section title={t.english.meanings}>
          <Text variant="small" color="textMuted" style={{ paddingHorizontal: 6, marginTop: -4 }}>
            {t.english.intro(term)}
          </Text>
          {meanings.map((meaning, index) => (
            <Animated.View
              key={`${meaning.entryId}:${meaning.sense}`}
              entering={FadeInDown.delay(80 + Math.min(index, 6) * 60).duration(350)}
            >
              <MeaningCard
                meaning={meaning}
                number={index + 1}
                saved={saved.has(`${meaning.entryId}:${meaning.sense}`)}
                saving={addNote.isPending}
                onSave={() => save(meaning)}
              />
            </Animated.View>
          ))}
        </Section>
      )}
    </Screen>
  )
}
