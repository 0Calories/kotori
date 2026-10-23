import type { Example, Nuance, Sense, SimilarWord } from "@kotori/domain"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { Platform, Share, View } from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useAddNote, useEnrich, useEntry, useNotes } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Furigana } from "../../src/components/Furigana.tsx"
import { Icon, type IconName } from "../../src/components/Icon.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { NuanceScales } from "../../src/components/NuanceScales.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Header, Screen, Section } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { posLabel, type Strings } from "../../src/i18n/strings.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

/** Below this confidence a judgment is shown faded rather than stated outright. */
const CONFIDENT = 0.55

/** Web browsers without the Web Share API can't share, so the button is left out there. */
const canShare = Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator)

/** The nuance worth saying in words: tags such as "Young people", and cautions such as "Slang". */
const nuanceNotes = (t: Strings, nuance: Nuance) => {
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
  const cautions: Array<{ readonly label: string; readonly icon: IconName }> = [
    ...(nuance.cautions.rudeToSuperiors >= 0.6 ? [{ label: t.nuance.cautionRude, icon: "work_off" as const }] : []),
    ...(nuance.cautions.stiffWithFriends >= 0.6 ? [{ label: t.nuance.cautionStiff, icon: "info" as const }] : []),
    ...(nuance.cautions.slang >= 0.6 ? [{ label: t.nuance.cautionSlang, icon: "info" as const }] : [])
  ]
  return { tags, cautions }
}

const NuanceNotes = ({ nuance }: { readonly nuance: Nuance }) => {
  const { t } = useSession()
  const { tags, cautions } = nuanceNotes(t, nuance)
  if (tags.length + cautions.length === 0) return null
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {tags.map((tag) => (
        <Chip key={tag} label={tag} />
      ))}
      {cautions.map((caution) => (
        <Chip key={caution.label} tone="accent" icon={caution.icon} label={caution.label} />
      ))}
    </View>
  )
}

/** Where the word sits between casual and formal, and between speech and writing. */
const NuanceCard = ({ nuance }: { readonly nuance: Nuance }) => {
  const { t } = useSession()
  return (
    <Card style={{ gap: 14, paddingHorizontal: 18, paddingBottom: 12 }}>
      <NuanceScales
        rows={[
          {
            left: t.nuance.poles.casual,
            right: t.nuance.poles.formal,
            position: nuance.formality.position,
            value: t.nuance.scale[nuance.formality.value],
            faded: nuance.formality.confidence < CONFIDENT
          },
          {
            left: t.nuance.poles.spoken,
            right: t.nuance.poles.written,
            position: nuance.medium.position,
            value: t.nuance.mediumScale[nuance.medium.value],
            faded: nuance.medium.confidence < CONFIDENT
          }
        ]}
      />
      <NuanceNotes nuance={nuance} />
    </Card>
  )
}

const ExampleRow = ({ example, mark }: { readonly example: Example; readonly mark: string | undefined }) => {
  const theme = useTheme()
  const { profile } = useSession()
  // Japanese speakers are learning the English side, so it leads and is the one spoken.
  const english = profile?.targetLanguage === "en"
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.sm,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 8
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        {english ? (
          <>
            <Text variant="strong" selectable>
              {example.en}
            </Text>
            <Text jp variant="small" color="textMuted">
              {example.ja}
            </Text>
          </>
        ) : (
          <>
            <Furigana
              text={example.ja}
              furigana={example.furigana}
              size={16}
              marks={mark ? [{ text: mark, kind: "highlight" }] : []}
            />
            <Text variant="small" color="textMuted">
              {example.en}
            </Text>
          </>
        )}
        {example.note ? (
          <Text variant="caption" color="textFaint">
            {example.note}
          </Text>
        ) : null}
      </View>
      <AudioButton url={english ? example.translationAudioUrl : example.audioUrl} />
    </View>
  )
}

const SenseCard = ({
  sense,
  number,
  forms,
  partOfSpeech,
  showNuance,
  saved,
  onSave,
  saving
}: {
  readonly sense: Sense
  readonly number: number
  /** Ways the headword is written, to find and mark it in examples. */
  readonly forms: ReadonlyArray<string>
  /** Already shown in the hero; repeated only when this sense differs. */
  readonly partOfSpeech: string | null
  readonly showNuance: boolean
  readonly saved: boolean
  readonly onSave: () => void
  readonly saving: boolean
}) => {
  const { t } = useSession()
  const theme = useTheme()
  const router = useRouter()
  const [first, second, ...rest] = sense.glosses
  const pos = [...new Set(sense.partsOfSpeech.map((tag) => posLabel(t, tag.code) ?? tag.label))].filter(
    (label) => label !== partOfSpeech
  )
  const open = (id: number) => router.push({ pathname: "/entry/[id]", params: { id: String(id) } })
  const tags = [...sense.misc, ...sense.fields, ...sense.dialects]

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
          <View style={{ flex: 1, gap: 4, paddingTop: 1 }}>
            <Text variant="heading" selectable>
              {second ? `${first}; ${second}` : first}
            </Text>
            {rest.length > 0 ? <Text color="textMuted">{rest.join("; ")}</Text> : null}
          </View>
          <View style={{ marginTop: -9, marginRight: -8 }}>
            <IconButton
              icon="bookmark"
              filled={saved}
              size={40}
              label={saved ? t.entry.saved : t.entry.save}
              onPress={saved || saving ? undefined : onSave}
            />
          </View>
        </View>
        {pos.length + tags.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {pos.map((label) => (
              <Chip key={label} label={label} />
            ))}
            {tags.map((tag) => (
              <Chip key={tag.code} label={tag.label} />
            ))}
          </View>
        ) : null}
        {sense.info.map((note) => (
          <Text key={note} color="textMuted">
            {note}
          </Text>
        ))}
        {sense.appliesTo.length > 0 ? (
          <Text variant="caption" color="textFaint">
            {t.entry.appliesTo(sense.appliesTo.join("、"))}
          </Text>
        ) : null}
        {showNuance && sense.nuance ? <NuanceNotes nuance={sense.nuance} /> : null}
        {sense.examples.map((example) => (
          <ExampleRow key={example.id} example={example} mark={forms.find((form) => example.ja.includes(form))} />
        ))}
        {sense.related.length + sense.antonyms.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {sense.related.map((ref) => (
              <PressableScale key={`r-${ref.text}`} onPress={ref.entryId ? () => open(ref.entryId!) : undefined}>
                <Chip icon="link" label={ref.text} />
              </PressableScale>
            ))}
            {sense.antonyms.map((ref) => (
              <PressableScale key={`a-${ref.text}`} onPress={ref.entryId ? () => open(ref.entryId!) : undefined}>
                <Chip icon="swap_horiz" label={ref.text} />
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  )
}

/** Words close to this one, each with how it differs. */
const SimilarList = ({ words }: { readonly words: ReadonlyArray<SimilarWord> }) => {
  const { t } = useSession()
  const theme = useTheme()
  const router = useRouter()
  return (
    <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
      {words.map((word, index) => (
        <PressableScale
          key={word.entryId}
          scaleTo={0.98}
          accessibilityRole="link"
          accessibilityLabel={`${word.headword}, ${t.nuance.difference[word.difference]}, ${word.meaning}`}
          onPress={() => router.push({ pathname: "/entry/[id]", params: { id: String(word.entryId) } })}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 12,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.color.divider
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text mincho size={23} style={{ lineHeight: 28 }}>
                {word.headword}
              </Text>
              {word.reading !== word.headword ? (
                <Text jp variant="caption" color="textMuted">
                  {word.reading}
                </Text>
              ) : null}
            </View>
            <Text variant="small" color="textMuted" numberOfLines={2}>
              <Text variant="small" weight="semibold">
                {t.nuance.difference[word.difference]}
              </Text>
              {` · ${word.meaning}`}
            </Text>
          </View>
          <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
        </PressableScale>
      ))}
    </Card>
  )
}

/** A headword as large as fits: 64pt for short words, smaller for long ones. */
const headwordSize = (headword: string) => {
  const length = Array.from(headword).length
  return length <= 4 ? 64 : Math.max(36, Math.floor(280 / length))
}

export default function EntryScreen() {
  const { t, profile } = useSession()
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const entry = useEntry(Number(id))
  const notes = useNotes()
  const addNote = useAddNote()
  const enrich = useEnrich(Number(id))
  const [showAll, setShowAll] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"))

  if (entry.isError) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <ErrorState error={entry.error} onRetry={() => entry.refetch()} />
      </Screen>
    )
  }
  if (!entry.data) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
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
  const share = () =>
    Share.share({
      message: `${data.headword}${data.reading === data.headword ? "" : `（${data.reading}）`} ${data.senses[0]?.glosses.slice(0, 3).join("; ") ?? ""}`
    }).catch(() => {})

  const others = data.forms.filter((form) => form.text !== data.headword && form.text !== data.reading)
  const senses = showAll ? data.senses : data.senses.slice(0, 3)
  const waiting = data.enrichment.examples === "queued" || data.enrichment.nuance === "queued"
  const featured = data.senses.find((sense) => sense.nuance !== null)
  const similar = [
    ...new Map(data.senses.flatMap((sense) => sense.similar).map((word) => [word.entryId, word])).values()
  ]
  const byAi = data.senses.some((sense) => sense.nuance || sense.examples.length > 0 || sense.similar.length > 0)
  const firstPos = data.senses[0]?.partsOfSpeech[0]
  const partOfSpeech = firstPos ? (posLabel(t, firstPos.code) ?? firstPos.label) : null
  const forms = [data.headword, ...data.forms.map((form) => form.text), data.reading]
  const size = headwordSize(data.headword)
  // Romaji helps English speakers read the word; Japanese speakers don't need it.
  const learningJapanese = profile?.targetLanguage !== "en"
  // Words with nothing from Kotori yet get a plain header, with the part of speech among the details.
  const plain = !byAi && !waiting
  const meta = [
    data.reading === data.headword ? null : data.reading,
    data.common ? t.dictionary.common : null,
    plain ? partOfSpeech : null
  ].filter((part): part is string => part !== null)

  return (
    <Screen
      bottomInset={40}
      onScroll={(y) => setScrolled(y > size + 60)}
      header={
        <Header
          onBack={back}
          title={
            scrolled ? (
              <Text mincho size={22} numberOfLines={1}>
                {data.headword}
              </Text>
            ) : undefined
          }
          actions={
            <>
              <IconButton
                icon="bookmark"
                filled={savedSenses.has(0)}
                label={savedSenses.has(0) ? t.entry.saved : t.entry.save}
                onPress={
                  savedSenses.has(0) || addNote.isPending || !data.senses[0] ? undefined : () => save(data.senses[0]!)
                }
              />
              {canShare ? (
                <IconButton
                  icon={Platform.OS === "android" ? "share" : "ios_share"}
                  label={t.entry.share}
                  onPress={share}
                />
              ) : null}
            </>
          }
        />
      }
    >
      <Animated.View
        entering={FadeInDown.duration(350)}
        style={
          plain
            ? { paddingHorizontal: 6, paddingTop: 4, marginBottom: 8 }
            : {
                borderRadius: theme.radius.xl,
                overflow: "hidden",
                backgroundColor: theme.color.primaryTint,
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 18
              }
        }
      >
        {plain ? null : <Snow />}
        <Text
          mincho
          size={size}
          style={plain ? { lineHeight: size } : { lineHeight: Math.round(size * 1.1), letterSpacing: size * 0.02 }}
          selectable
          accessibilityRole="header"
        >
          {data.headword}
        </Text>
        {learningJapanese || meta.length > 0 ? (
          <Text
            variant="caption"
            size={14}
            color="textMuted"
            style={{ marginTop: plain ? 16 : 6, lineHeight: plain ? 17 : 18 }}
          >
            {learningJapanese ? (
              <Text variant="caption" size={14} weight="semibold" color="text">
                {data.romaji}
              </Text>
            ) : null}
            {(learningJapanese && meta.length > 0 ? " · " : "") + meta.join(" · ")}
          </Text>
        ) : null}
        {others.length > 0 ? (
          <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
            {t.entry.forms}: {others.map((form) => form.text).join("・")}
          </Text>
        ) : null}
        {plain && !data.audioUrl ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, minHeight: 44 }}>
            {data.audioUrl ? <AudioButton url={data.audioUrl} label={t.common.listen} /> : null}
            <View style={{ flex: 1 }} />
            {partOfSpeech && !plain ? (
              <Text variant="caption" size={13.5} color="textMuted">
                {partOfSpeech}
              </Text>
            ) : null}
          </View>
        )}
      </Animated.View>

      {featured?.nuance ? (
        <Animated.View entering={FadeInDown.delay(60).duration(350)}>
          <NuanceCard nuance={featured.nuance} />
        </Animated.View>
      ) : null}

      {waiting ? (
        <Animated.View entering={FadeIn}>
          <Card tone="primary" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Mascot size={52} mood="thinking" />
            <Text variant="small" style={{ flex: 1 }}>
              {data.enrichment.examples === "queued" ? t.entry.writing : t.entry.judging}
            </Text>
          </Card>
        </Animated.View>
      ) : null}

      <Section
        title={data.senses.length === 1 ? t.entry.meaning : t.entry.meanings}
        action={
          byAi ? null : (
            <Text variant="caption" color="textMuted">
              {t.entry.fromDictionary}
            </Text>
          )
        }
      >
        {byAi ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, marginTop: -4 }}>
            <Icon name="info" size={16} color={theme.color.textMuted} />
            <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
              {t.entry.byAi}
            </Text>
            <PressableScale onPress={() => router.push("/settings")} accessibilityRole="link" hitSlop={12}>
              <Text variant="caption" weight="semibold" style={{ textDecorationLine: "underline" }}>
                {t.entry.sources}
              </Text>
            </PressableScale>
          </View>
        ) : null}
        {senses.map((sense, index) => (
          <Animated.View key={sense.index} entering={FadeInDown.delay(80 + index * 60).duration(350)}>
            <SenseCard
              sense={sense}
              number={index + 1}
              forms={forms}
              partOfSpeech={partOfSpeech}
              showNuance={sense !== featured}
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

      {!byAi && !waiting ? (
        <View
          style={{
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.lg,
            padding: theme.space.lg,
            gap: 14
          }}
        >
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: theme.color.surface,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Mascot size={36} mood="sleepy" />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="strong" weight="bold" size={15}>
                {t.entry.dictionaryOnly}
              </Text>
              <Text variant="small" color="textMuted">
                {t.entry.dictionaryOnlyBody(data.headword)}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-start" }}>
            <Button
              variant="secondary"
              icon={enrich.isSuccess ? "check" : "add"}
              label={t.entry.ask}
              loading={enrich.isPending}
              disabled={enrich.isSuccess}
              onPress={() => enrich.mutate()}
            />
          </View>
        </View>
      ) : null}

      {similar.length > 0 ? (
        <Section title={t.entry.similar}>
          <Text variant="small" color="textMuted" style={{ paddingHorizontal: 6, marginTop: -4 }}>
            {t.entry.similarIntro(data.headword)}
          </Text>
          <SimilarList words={similar} />
        </Section>
      ) : null}
    </Screen>
  )
}
