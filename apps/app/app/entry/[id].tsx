import Ionicons from "@expo/vector-icons/Ionicons"
import type { Nuance, Sense } from "@kotori/domain"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useAddNote, useEntry, useNotes } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Furigana } from "../../src/components/Furigana.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { Meter } from "../../src/components/Meter.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { posLabel } from "../../src/i18n/strings.ts"
import { formalityTone } from "../../src/lib/tones.ts"
import { useT } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const FORMALITY = ["vulgar", "casual", "neutral", "polite", "formal"] as const
const MEDIUM = ["spoken", "both", "written"] as const

/** Below this confidence a judgment is shown faded rather than stated outright. */
const CONFIDENT = 0.55

const NuancePanel = ({ nuance }: { readonly nuance: Nuance }) => {
  const t = useT()
  const theme = useTheme()
  const tags = [
    nuance.keigo.value !== "none" && nuance.keigo.confidence >= CONFIDENT ? t.nuance.keigo[nuance.keigo.value] : null,
    nuance.gender.value !== "neutral" && nuance.gender.confidence >= CONFIDENT
      ? t.nuance.gender[nuance.gender.value]
      : null,
    nuance.age.value !== "any" && nuance.age.confidence >= CONFIDENT ? t.nuance.age[nuance.age.value] : null,
    nuance.currency.value !== "current" && nuance.currency.confidence >= CONFIDENT
      ? t.nuance.currency[nuance.currency.value]
      : null,
    nuance.connotation.value !== "neutral" && nuance.connotation.confidence >= CONFIDENT
      ? t.nuance.connotation[nuance.connotation.value]
      : null
  ].filter((tag): tag is string => tag !== null && tag.length > 0)
  const cautions = [
    nuance.cautions.rudeToSuperiors >= 0.6 ? t.nuance.cautionRude : null,
    nuance.cautions.stiffWithFriends >= 0.6 ? t.nuance.cautionStiff : null,
    nuance.cautions.slang >= 0.6 ? t.nuance.cautionSlang : null
  ].filter((c): c is string => c !== null)

  return (
    <View
      style={{
        gap: theme.space.lg,
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.md,
        padding: theme.space.lg
      }}
    >
      <Meter
        title={t.nuance.formality}
        labels={FORMALITY.map((level) => t.nuance.scale[level])}
        position={nuance.formality.position}
        value={t.nuance.scale[nuance.formality.value]}
        faded={nuance.formality.confidence < CONFIDENT}
      />
      <Meter
        title={t.nuance.medium}
        labels={MEDIUM.map((level) => t.nuance.mediumScale[level])}
        position={nuance.medium.position}
        value={t.nuance.mediumScale[nuance.medium.value]}
        faded={nuance.medium.confidence < CONFIDENT}
      />
      {tags.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {tags.map((tag) => (
            <Chip key={tag} tone="lavender" label={tag} />
          ))}
        </View>
      ) : null}
      {cautions.map((caution) => (
        <View key={caution} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Ionicons name="alert-circle" size={16} color={theme.color.yuzu} />
          <Text variant="small" style={{ flex: 1 }}>
            {caution}
          </Text>
        </View>
      ))}
    </View>
  )
}

const SenseCard = ({
  sense,
  saved,
  onSave,
  saving
}: {
  readonly sense: Sense
  readonly saved: boolean
  readonly onSave: () => void
  readonly saving: boolean
}) => {
  const t = useT()
  const theme = useTheme()
  const router = useRouter()
  const [first, ...rest] = sense.glosses
  const pos = [...new Set(sense.partsOfSpeech.map((tag) => posLabel(t, tag.code) ?? tag.label))]
  const open = (id: number) => router.push({ pathname: "/entry/[id]", params: { id: String(id) } })

  return (
    <Card style={{ gap: theme.space.lg }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: theme.color.primarySoft,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2
          }}
        >
          <Text variant="label" color="primary">
            {sense.index + 1}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="heading">{first}</Text>
          {rest.length > 0 ? <Text color="textMuted">{rest.join("; ")}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {pos.map((label) => (
              <Chip key={label} label={label} />
            ))}
            {[...sense.misc, ...sense.fields, ...sense.dialects].map((tag) => (
              <Chip key={tag.code} tone="yuzu" label={tag.label} />
            ))}
          </View>
          {sense.info.map((note) => (
            <Text key={note} variant="small" color="textMuted">
              {note}
            </Text>
          ))}
          {sense.appliesTo.length > 0 ? (
            <Text variant="caption" color="textFaint">
              {t.entry.appliesTo(sense.appliesTo.join("、"))}
            </Text>
          ) : null}
        </View>
        <IconButton
          icon={saved ? "bookmark" : "bookmark-outline"}
          label={saved ? t.entry.saved : t.entry.save}
          tone="primary"
          active={saved}
          onPress={saved || saving ? undefined : onSave}
        />
      </View>

      {sense.nuance ? <NuancePanel nuance={sense.nuance} /> : null}

      {sense.similar.length > 0 ? (
        <Section title={t.entry.similar}>
          {sense.similar.map((word) => (
            <PressableScale key={word.entryId} onPress={() => open(word.entryId)} scaleTo={0.98}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}>
                <View style={{ minWidth: 72 }}>
                  <Text jp variant="strong" size={18}>
                    {word.headword}
                  </Text>
                  {word.reading !== word.headword ? (
                    <Text jp variant="caption" color="textMuted">
                      {word.reading}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Chip
                    tone={word.formality ? formalityTone[word.formality] : "rose"}
                    label={t.nuance.difference[word.difference]}
                  />
                  <Text variant="small" color="textMuted" numberOfLines={1}>
                    {word.meaning}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.color.textFaint} />
              </View>
            </PressableScale>
          ))}
        </Section>
      ) : null}

      {sense.examples.length > 0 ? (
        <Section title={t.entry.examples}>
          {sense.examples.map((example) => (
            <View
              key={example.id}
              style={{ gap: 6, borderLeftWidth: 3, borderLeftColor: theme.color.primarySoft, paddingLeft: 12 }}
            >
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <Furigana text={example.ja} furigana={example.furigana} size={19} />
                </View>
                <AudioButton url={example.audioUrl} size={34} />
              </View>
              <Text color="textMuted">{example.en}</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <Chip tone={formalityTone[example.formality]} label={t.nuance.scale[example.formality]} />
                {example.note ? (
                  <Text variant="caption" color="textFaint" style={{ flex: 1 }}>
                    {example.note}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      {sense.related.length + sense.antonyms.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {sense.related.map((ref) => (
            <PressableScale key={`r-${ref.text}`} onPress={ref.entryId ? () => open(ref.entryId!) : undefined}>
              <Chip tone="sky" icon="link" label={ref.text} />
            </PressableScale>
          ))}
          {sense.antonyms.map((ref) => (
            <PressableScale key={`a-${ref.text}`} onPress={ref.entryId ? () => open(ref.entryId!) : undefined}>
              <Chip tone="plum" icon="swap-horizontal" label={ref.text} />
            </PressableScale>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

export default function EntryScreen() {
  const t = useT()
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const entry = useEntry(Number(id))
  const notes = useNotes()
  const addNote = useAddNote()
  const [showAll, setShowAll] = useState(false)

  if (entry.isError) {
    return (
      <Screen bottomInset={40}>
        <ErrorState error={entry.error} onRetry={() => entry.refetch()} />
      </Screen>
    )
  }
  if (!entry.data) {
    return (
      <Screen bottomInset={40}>
        <MascotMessage mood="thinking" />
      </Screen>
    )
  }

  const data = entry.data
  const savedSenses = new Set(
    (notes.data ?? []).flatMap((note) =>
      note.content.kind === "word" && note.content.entryId === data.id ? [note.content.senseIndex] : []
    )
  )
  const save = (sense: Sense) => {
    const example = sense.examples[0]
    const nuance = sense.nuance
    addNote.mutate({
      content: {
        kind: "word",
        entryId: data.id,
        senseIndex: sense.index,
        headword: data.headword,
        reading: data.reading,
        meaning: sense.glosses.slice(0, 3).join("; "),
        hint: nuance && nuance.formality.value !== "neutral" ? t.nuance.scale[nuance.formality.value] : null,
        example: example
          ? { ja: example.ja, furigana: example.furigana, en: example.en, audioUrl: example.audioUrl }
          : null,
        audioUrl: data.audioUrl
      }
    })
  }
  const others = data.forms.filter((form) => form.text !== data.headword && form.text !== data.reading)
  const senses = showAll ? data.senses : data.senses.slice(0, 3)
  const waiting = data.enrichment.examples === "queued" || data.enrichment.nuance === "queued"

  return (
    <Screen bottomInset={40}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <IconButton
          icon="chevron-back"
          label={t.common.close}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      </View>

      <Animated.View entering={FadeInDown.duration(350)}>
        <Card style={{ alignItems: "center", gap: theme.space.sm, paddingVertical: theme.space.xl }}>
          {data.reading !== data.headword ? (
            <Text jp color="textMuted" size={18}>
              {data.reading}
            </Text>
          ) : null}
          <Text jp size={48} style={{ lineHeight: 60 }} selectable>
            {data.headword}
          </Text>
          <Text variant="caption" color="textFaint">
            {data.romaji}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: theme.space.sm, alignItems: "center" }}>
            <AudioButton url={data.audioUrl} size={46} />
            {data.common ? <Chip tone="matcha" label={t.dictionary.common} style={{ alignSelf: "center" }} /> : null}
          </View>
          {others.length > 0 ? (
            <Text variant="small" color="textMuted" jp style={{ marginTop: theme.space.sm }}>
              {t.entry.forms}: {others.map((f) => f.text).join("・")}
            </Text>
          ) : null}
          <View style={{ marginTop: theme.space.md }}>
            <Button
              label={savedSenses.has(0) ? t.entry.saved : t.entry.save}
              icon={savedSenses.has(0) ? "checkmark" : "bookmark-outline"}
              variant={savedSenses.has(0) ? "soft" : "primary"}
              loading={addNote.isPending}
              onPress={() => !savedSenses.has(0) && data.senses[0] && save(data.senses[0])}
            />
          </View>
        </Card>
      </Animated.View>

      {waiting ? (
        <Animated.View entering={FadeIn}>
          <Card tone="sky" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Mascot size={52} mood="thinking" />
            <Text variant="small" style={{ flex: 1 }}>
              {data.enrichment.examples === "queued" ? t.entry.writing : t.entry.judging}
            </Text>
          </Card>
        </Animated.View>
      ) : null}

      <Section title={t.entry.meanings}>
        {senses.map((sense, index) => (
          <Animated.View key={sense.index} entering={FadeInDown.delay(80 + index * 60).duration(350)}>
            <SenseCard
              sense={sense}
              saved={savedSenses.has(sense.index)}
              saving={addNote.isPending}
              onSave={() => save(sense)}
            />
          </Animated.View>
        ))}
        {data.senses.length > 3 ? (
          <Button
            variant="ghost"
            label={showAll ? t.common.less : `${t.common.more} (${data.senses.length - 3})`}
            onPress={() => setShowAll(!showAll)}
          />
        ) : null}
      </Section>
    </Screen>
  )
}
