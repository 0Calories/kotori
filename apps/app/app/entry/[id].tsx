import type { Entry, Language, Sense, SimilarWord } from "@kotori/contracts"
import { Link, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { Platform, Share, View } from "react-native"
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated"
import { useAddNote, useEntry, useEntryEnrichment, useNotes, useRemoveNote } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Cautions } from "../../src/components/Cautions.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { ExampleRow } from "../../src/components/ExampleRow.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { ChipRow } from "../../src/components/LabelChips.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { Notice } from "../../src/components/Notice.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { removalErrorText, RemoveNoteDialog } from "../../src/components/RemoveNote.tsx"
import { Header, Screen, Section } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { UsagePatterns } from "../../src/components/UsagePatterns.tsx"
import { posLabel, tagName } from "../../src/i18n/strings.ts"
import {
  contributors,
  hasKotoriContent,
  hasKotoriMarks,
  heroItems,
  labelItems,
  loanLine,
  saveDetails,
  senseCautions,
  similarWords,
  wordCautions
} from "../../src/lib/entry.ts"
import { enrichmentNotice } from "../../src/lib/enrichment.ts"
import { findForm } from "../../src/lib/forms.ts"
import { wordNote } from "../../src/lib/notes.ts"
import { entryIdFromParam, entrySourcesHref } from "../../src/lib/sources.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

/** Web browsers without the Web Share API can't share, so the button is left out there. */
const canShare = Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator)

/** Glosses run together as their language lists them: "to eat; to dine", "食べる、食事をする". */
const glossSeparator = (language: Language) => (language === "ja" ? "; " : "、")

/**
 * One meaning: its glosses, then what is true of this sense and not the word as a whole (a part
 * of speech or label the hero doesn't show), the dictionary's usage patterns with Kotori's beside
 * them, examples, and any caution about this sense alone.
 */
const SenseCard = ({
  entry,
  sense,
  number,
  forms,
  partOfSpeech,
  saved,
  onSave,
  saving,
  removing,
  onRemove
}: {
  readonly entry: Entry
  readonly sense: Sense
  readonly number: number
  /** Ways the headword is written or inflected, to find and mark it in examples. */
  readonly forms: ReadonlyArray<string>
  /** Already shown in the hero; repeated only when this sense differs. */
  readonly partOfSpeech: string | null
  readonly saved: boolean
  readonly onSave: () => void
  readonly saving: boolean
  readonly removing: boolean
  readonly onRemove: () => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const router = useRouter()
  const language = entry.language
  const [first, second, ...rest] = sense.glosses
  const separator = glossSeparator(language)
  const pos = [...new Set(sense.partsOfSpeech.map((tag) => posLabel(t, tag.code) ?? tag.name))].filter(
    (label) => label !== partOfSpeech
  )
  const fields = sense.fields.map((tag) => tagName(t, tag))
  const antonyms = sense.antonyms

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
              {second ? `${first}${separator}${second}` : first}
            </Text>
            {rest.length > 0 ? <Text color="textMuted">{rest.join(separator)}</Text> : null}
          </View>
          <View style={{ marginTop: -9, marginRight: -8 }}>
            <IconButton
              icon="bookmark"
              filled={saved}
              size={40}
              label={saved ? t.saved.remove : t.entry.save}
              onPress={removing ? undefined : saved ? onRemove : saving ? undefined : onSave}
            />
          </View>
        </View>
        <ChipRow items={labelItems(t, sense.labels)} plain={[...pos, ...fields]} />
        {sense.appliesTo.length > 0 ? (
          <Text variant="caption" color="textFaint">
            {t.entry.appliesTo(sense.appliesTo.join("、"))}
          </Text>
        ) : null}
        <UsagePatterns usagePatterns={sense.usagePatterns} />
        {sense.examples.map((example) => (
          <ExampleRow
            key={example.id}
            example={example}
            language={language}
            mark={findForm(language === "ja" ? example.ja : example.en, forms, language)}
          />
        ))}
        <Cautions cautions={senseCautions(entry.cautions, sense.index)} headline={false} />
        {antonyms.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Text variant="caption" color="textFaint">
              {t.entry.antonyms}
            </Text>
            {antonyms.map((ref) => (
              <PressableScale
                key={ref.text}
                accessibilityRole={ref.entryId === null ? undefined : "link"}
                onPress={
                  ref.entryId === null
                    ? undefined
                    : () => router.push({ pathname: "/entry/[id]", params: { id: String(ref.entryId) } })
                }
              >
                <Chip icon="swap_horiz" label={ref.text} />
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  )
}

/** Words close to this one, each with how it differs, read off the two words' labels. */
const SimilarList = ({
  words,
  language
}: {
  readonly words: ReadonlyArray<SimilarWord>
  /** Similar words come from the same dictionary as the entry. */
  readonly language: Language
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const router = useRouter()
  return (
    <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
      {words.map((word, index) => (
        <PressableScale
          key={word.entryId}
          scaleTo={0.98}
          accessibilityRole="link"
          accessibilityLabel={`${word.headword}, ${t.entry.difference[word.difference]}, ${word.meaning}`}
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
              <Headword language={language} size={language === "ja" ? 23 : 20} style={{ lineHeight: 28 }}>
                {word.headword}
              </Headword>
              {word.reading.length > 0 && word.reading !== word.headword ? (
                <Text jp={language === "ja"} variant="caption" color="textMuted">
                  {word.reading}
                </Text>
              ) : null}
            </View>
            <Text variant="small" color="textMuted" numberOfLines={2}>
              <Text variant="small" weight="semibold">
                {t.entry.difference[word.difference]}
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

/** A headword as large as fits: 64pt for short Japanese words and 52pt for short English ones, smaller for long ones. */
const headwordSize = (headword: string, language: Language) => {
  const length = Array.from(headword).length
  if (language === "en") return length <= 8 ? 52 : Math.max(30, Math.floor(420 / length))
  return length <= 4 ? 64 : Math.max(36, Math.floor(280 / length))
}

export default function EntryScreen() {
  const theme = useTheme()
  const { t } = useSession()
  const router = useRouter()
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>()
  const id = entryIdFromParam(rawId)
  const entry = useEntry(id ?? 0)
  const notes = useNotes()
  const addNote = useAddNote()
  const removeNote = useRemoveNote()
  const enrichment = useEntryEnrichment(id ?? 0, entry.data?.enrichment, !entry.isFetching)
  const [showAll, setShowAll] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [removingSense, setRemovingSense] = useState<number | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"))

  // A failed refetch keeps the entry already loaded, with a notice until a later one succeeds, as
  // does a failed check on its examples and audio. Only a failed first load has nothing to show.
  if (id === null || entry.isLoadingError) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <ErrorState error={entry.error} onRetry={id === null ? undefined : () => entry.refetch()} />
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
  const language = data.language
  const savedSenses = new Set(
    (notes.data ?? []).flatMap((note) =>
      note.content.kind === "word" && note.content.entryId === data.id ? [note.content.senseIndex] : []
    )
  )
  const savedNote = (senseIndex: number) =>
    (notes.data ?? []).find(
      (note) =>
        note.content.kind === "word" && note.content.entryId === data.id && note.content.senseIndex === senseIndex
    )
  const beginRemove = (senseIndex: number) => {
    setRemoveError(null)
    setRemovingSense(senseIndex)
  }
  const confirmRemove = async () => {
    if (removingSense === null || removeNote.isPending) return
    const note = savedNote(removingSense)
    if (note === undefined) {
      setRemovingSense(null)
      return
    }
    setRemoveError(null)
    try {
      await removeNote.mutateAsync(note.id)
      setRemovingSense(null)
    } catch (error) {
      setRemoveError(removalErrorText(t, error))
    }
  }
  const save = (sense: Sense) =>
    addNote.mutate({
      content: wordNote({
        entryId: data.id,
        language,
        sense: sense.index,
        headword: data.headword,
        reading: data.reading,
        glosses: sense.glosses,
        ...saveDetails(t, data, sense),
        example: sense.examples[0],
        audioUrl: data.audioUrl
      })
    })
  const reading = data.reading.length > 0 && data.reading !== data.headword ? data.reading : null
  const share = () =>
    Share.share({
      message: `${data.headword}${reading === null ? "" : language === "ja" ? `（${reading}）` : ` ${reading}`} ${
        data.senses[0]?.glosses.slice(0, 3).join(glossSeparator(language)) ?? ""
      }`
    }).catch(() => {})

  // Other spellings ("colour", 喰べる), and for English words their inflections ("ate", "eaten").
  const others = data.forms.filter(
    (form) => form.kind !== "inflection" && form.text !== data.headword && form.text !== data.reading
  )
  const inflections = data.forms.filter((form) => form.kind === "inflection")
  const senses = showAll ? data.senses : data.senses.slice(0, 3)
  const waiting = enrichment.writing
  const askNotice = enrichmentNotice(t, enrichment.phase, enrichment.error)
  const similar = similarWords(data.senses)
  const firstPos = data.senses[0]?.partsOfSpeech[0]
  const partOfSpeech = firstPos ? (posLabel(t, firstPos.code) ?? firstPos.name) : null
  const forms = [data.headword, ...data.forms.map((form) => form.text), ...(language === "ja" ? [data.reading] : [])]
  const size = headwordSize(data.headword, language)
  const headwordAudio = data.audioUrl
  // A word with nothing from Kotori yet gets a plain header, with the part of speech among the
  // details, and an offer to ask for more.
  const plain = !hasKotoriContent(data) && !waiting
  const meta = [reading, data.usuallyKana ? t.entry.usuallyKana : null, plain ? partOfSpeech : null].filter(
    (part): part is string => part !== null
  )
  const origin = loanLine(t, data)
  const chips = heroItems(t, data)

  return (
    <Screen
      bottomInset={40}
      onScroll={(y) => setScrolled(y > size + 60)}
      header={
        <Header
          onBack={back}
          title={
            scrolled ? (
              <Headword language={language} size={language === "ja" ? 22 : 20} numberOfLines={1}>
                {data.headword}
              </Headword>
            ) : undefined
          }
          actions={
            <>
              <IconButton
                icon="bookmark"
                filled={savedSenses.has(0)}
                label={savedSenses.has(0) ? t.saved.remove : t.entry.save}
                onPress={
                  removeNote.isPending || addNote.isPending || !data.senses[0]
                    ? undefined
                    : savedSenses.has(0)
                      ? () => beginRemove(0)
                      : () => save(data.senses[0]!)
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
      <RemoveNoteDialog
        note={removingSense === null ? undefined : savedNote(removingSense)}
        busy={removeNote.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => {
          setRemovingSense(null)
          setRemoveError(null)
        }}
      />
      {entry.isRefetchError || enrichment.pollFailed ? (
        <Notice
          message={t.common.notRefreshed}
          action={{
            label: t.common.retry,
            onPress: () => (entry.isRefetchError ? void entry.refetch() : enrichment.retryPoll())
          }}
        />
      ) : null}
      {/* Asking for examples was refused (Kotori writes them later) or failed (asking again is the retry). */}
      <Notice
        message={askNotice}
        action={enrichment.phase === "failed" ? { label: t.common.retry, onPress: enrichment.ask } : undefined}
      />
      <Animated.View
        entering={FadeInDown.duration(350)}
        style={
          plain
            ? { paddingHorizontal: 6, paddingTop: 4, marginBottom: 8, gap: 2 }
            : {
                borderRadius: theme.radius.xl,
                overflow: "hidden",
                backgroundColor: theme.color.primaryTint,
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 18,
                gap: 2
              }
        }
      >
        {plain ? null : <Snow />}
        <Headword
          language={language}
          size={size}
          style={
            language === "en"
              ? { lineHeight: Math.round(size * 1.15) }
              : plain
                ? { lineHeight: size }
                : { lineHeight: Math.round(size * 1.1), letterSpacing: size * 0.02 }
          }
          selectable
          accessibilityRole="header"
        >
          {data.headword}
        </Headword>
        {meta.length > 0 ? (
          <Text
            variant="caption"
            size={14}
            color="textMuted"
            style={{ marginTop: plain ? 16 : 4, lineHeight: plain ? 17 : 18 }}
          >
            {meta.join(" · ")}
          </Text>
        ) : null}
        {origin ? (
          <Text variant="caption" color="textMuted">
            {origin}
          </Text>
        ) : null}
        {others.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t.entry.forms}: {others.map((form) => form.text).join(language === "ja" ? "・" : ", ")}
          </Text>
        ) : null}
        {inflections.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t.entry.inflections}: {inflections.map((form) => form.text).join(", ")}
          </Text>
        ) : null}
        {chips.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <ChipRow items={chips} onTint={!plain} />
          </View>
        ) : null}
        {plain && !headwordAudio ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, minHeight: 44 }}>
            {headwordAudio ? <AudioButton url={headwordAudio} label={t.common.listen} /> : null}
            <View style={{ flex: 1 }} />
            {partOfSpeech && !plain ? (
              <Text variant="caption" size={13.5} color="textMuted">
                {partOfSpeech}
              </Text>
            ) : null}
          </View>
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(350)}>
        <Cautions cautions={wordCautions(data.cautions)} headline />
      </Animated.View>

      {waiting ? (
        <Animated.View entering={FadeIn}>
          <Card tone="primary" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Mascot size={52} mood="thinking" />
            <Text variant="small" style={{ flex: 1 }}>
              {t.entry.writing}
            </Text>
          </Card>
        </Animated.View>
      ) : null}

      <Section title={data.senses.length === 1 ? t.entry.meaning : t.entry.meanings}>
        {senses.map((sense, index) => (
          <Animated.View key={sense.index} entering={FadeInDown.delay(80 + index * 60).duration(350)}>
            <SenseCard
              entry={data}
              sense={sense}
              number={index + 1}
              forms={forms}
              partOfSpeech={partOfSpeech}
              saved={savedSenses.has(sense.index)}
              saving={addNote.isPending}
              removing={removeNote.isPending}
              onSave={() => save(sense)}
              onRemove={() => beginRemove(sense.index)}
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

      {plain ? (
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
              icon={enrichment.asked ? "check" : "add"}
              label={t.entry.ask}
              loading={enrichment.asking}
              disabled={enrichment.asked}
              onPress={enrichment.ask}
            />
          </View>
        </View>
      ) : null}

      {similar.length > 0 ? (
        <Section title={t.entry.similar}>
          <Text variant="small" color="textMuted" style={{ paddingHorizontal: 6, marginTop: -4 }}>
            {t.entry.similarIntro(data.headword)}
          </Text>
          <SimilarList words={similar} language={language} />
        </Section>
      ) : null}

      <View style={{ paddingHorizontal: 6, gap: 8 }}>
        <Link href={entrySourcesHref(data.id)} asChild>
          <PressableScale accessibilityRole="link" hitSlop={8} style={{ alignSelf: "flex-start" }}>
            <Text variant="caption" color="textFaint">
              <Text variant="caption" weight="semibold" color="textMuted" style={{ textDecorationLine: "underline" }}>
                {t.entry.sources}
              </Text>
              {t.entry.sourcesList(contributors(t, data))}
            </Text>
          </PressableScale>
        </Link>
        {hasKotoriMarks(data) ? (
          <Text variant="caption" color="textFaint">
            {t.entry.kotoriLegend}
          </Text>
        ) : null}
      </View>
    </Screen>
  )
}
