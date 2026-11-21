import type { Entry, Language, Sense, SimilarWord } from "@kotori/contracts"
import { Link, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { Platform, Share, View } from "react-native"
import { useAddNote, useEntry, useNotes, useRemoveNote } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Cautions } from "../../src/components/Cautions.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { ExampleRow } from "../../src/components/ExampleRow.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { ChipRow } from "../../src/components/LabelChips.tsx"
import { Notice } from "../../src/components/Notice.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Header, Screen, Section } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { Skeleton, SkeletonCard, SkeletonGroup } from "../../src/components/Skeleton.tsx"
import { ErrorState } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { UsagePatterns } from "../../src/components/UsagePatterns.tsx"
import { posLabel, tagName } from "../../src/i18n/strings.ts"
import {
  contributors,
  hasKotoriMarks,
  heroItems,
  labelItems,
  loanLine,
  senseCautions,
  similarWords,
  wordCautions
} from "../../src/lib/entry.ts"
import { findForm } from "../../src/lib/forms.ts"
import { noteErrorText, noteOn } from "../../src/lib/notes.ts"
import { entryIdFromParam, entrySourcesHref } from "../../src/lib/sources.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

/** Whether an entry in this review state can be newly saved to the learner's notebook. */
const isSaveable = (state: Entry["reviewState"]): boolean => {
  switch (state) {
    case "approved":
    case "unreviewed":
      return true
    case "discarded":
      return false
  }
}

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
  partOfSpeech
}: {
  readonly entry: Entry
  readonly sense: Sense
  readonly number: number
  /** Ways the headword is written or inflected, to find and mark it in examples. */
  readonly forms: ReadonlyArray<string>
  /** Already shown in the hero; repeated only when this sense differs. */
  readonly partOfSpeech: string | null
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
        <View style={{ gap: 4, paddingTop: 1 }}>
          <Text variant="heading" selectable>
            {second ? `${first}${separator}${second}` : first}
          </Text>
          {rest.length > 0 ? <Text color="textMuted">{rest.join(separator)}</Text> : null}
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

/** The entry's hero and its first meanings, held in place while the entry loads. */
const EntrySkeleton = () => {
  const theme = useTheme()
  return (
    <SkeletonGroup style={{ gap: theme.space.lg }}>
      <View
        style={{
          borderRadius: theme.radius.xl,
          backgroundColor: theme.color.primaryTint,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 18,
          gap: 12
        }}
      >
        <Skeleton tone="onTint" width={140} height={56} radius={14} />
        <Skeleton tone="onTint" width={110} height={14} />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Skeleton tone="onTint" width={64} height={26} />
          <Skeleton tone="onTint" width={52} height={26} />
        </View>
        <Skeleton tone="onTint" width={108} height={44} style={{ marginTop: 4 }} />
      </View>
      <Skeleton width={90} height={16} style={{ marginTop: 8, marginLeft: 6 }} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
    </SkeletonGroup>
  )
}

export default function EntryScreen() {
  const theme = useTheme()
  const { t } = useSession()
  const router = useRouter()
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>()
  const id = entryIdFromParam(rawId)
  const entry = useEntry(id)
  const notes = useNotes()
  const addNote = useAddNote()
  const removeNote = useRemoveNote()
  const [showAll, setShowAll] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"))

  // A failed refetch (one of the polls while the entry is being enriched, say) keeps the entry
  // already loaded, with a notice until a later one succeeds. Only a failed first load has nothing to show.
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
        <EntrySkeleton />
      </Screen>
    )
  }

  const data = entry.data
  const language = data.language
  const saved = noteOn(notes.data, data.id)
  const saveable = isSaveable(data.reviewState)
  const busy = addNote.isPending || removeNote.isPending
  const toggleNote = async () => {
    if (busy) return
    setNoteError(null)
    if (saved !== undefined) {
      try {
        await removeNote.mutateAsync(saved.id)
      } catch (error) {
        setNoteError(noteErrorText(t, error, "remove"))
      }
      return
    }
    if (!saveable) return
    try {
      await addNote.mutateAsync({ entryId: data.id })
    } catch (error) {
      setNoteError(noteErrorText(t, error, "save"))
    }
  }
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
  const similar = similarWords(data.senses)
  const firstPos = data.senses[0]?.partsOfSpeech[0]
  const partOfSpeech = firstPos ? (posLabel(t, firstPos.code) ?? firstPos.name) : null
  const forms = [data.headword, ...data.forms.map((form) => form.text), ...(language === "ja" ? [data.reading] : [])]
  const size = headwordSize(data.headword, language)
  const headwordAudio = data.audioUrl
  const meta = [reading, data.usuallyKana ? t.entry.usuallyKana : null].filter((part): part is string => part !== null)
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
              {saveable || saved !== undefined ? (
                <IconButton
                  icon="bookmark"
                  filled={saved !== undefined}
                  label={saved !== undefined ? t.notebook.remove : t.entry.save}
                  onPress={busy ? undefined : () => void toggleNote()}
                />
              ) : null}
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
      <Notice message={noteError} />
      {entry.isRefetchError ? (
        <Notice
          message={t.common.notRefreshed}
          action={{ label: t.common.retry, onPress: () => void entry.refetch() }}
        />
      ) : null}
      <View
        style={{
          borderRadius: theme.radius.xl,
          overflow: "hidden",
          backgroundColor: theme.color.primaryTint,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 18,
          gap: 2
        }}
      >
        <Snow />
        <Headword
          language={language}
          size={size}
          style={
            language === "en"
              ? { lineHeight: Math.round(size * 1.15) }
              : { lineHeight: Math.round(size * 1.1), letterSpacing: size * 0.02 }
          }
          selectable
          accessibilityRole="header"
        >
          {data.headword}
        </Headword>
        {meta.length > 0 ? (
          <Text variant="caption" size={14} color="textMuted" style={{ marginTop: 4, lineHeight: 18 }}>
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
            <ChipRow items={chips} onTint />
          </View>
        ) : null}
        {headwordAudio || partOfSpeech ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, minHeight: 44 }}>
            {headwordAudio ? <AudioButton url={headwordAudio} label={t.common.listen} /> : null}
            <View style={{ flex: 1 }} />
            {partOfSpeech ? (
              <Text variant="caption" size={13.5} color="textMuted">
                {partOfSpeech}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <Cautions cautions={wordCautions(data.cautions)} headline />

      <Section title={data.senses.length === 1 ? t.entry.meaning : t.entry.meanings}>
        {senses.map((sense, index) => (
          <SenseCard
            key={sense.index}
            entry={data}
            sense={sense}
            number={index + 1}
            forms={forms}
            partOfSpeech={partOfSpeech}
          />
        ))}
        {data.senses.length > 3 ? (
          <Button
            variant="ghost"
            label={showAll ? t.common.less : `${t.common.more} (${data.senses.length - 3})`}
            onPress={() => setShowAll(!showAll)}
          />
        ) : null}
      </Section>

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
