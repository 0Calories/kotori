// PROTOTYPE ("Perch"): the entry page rebuilt around Kotori's own brand moments. The search screen's
// snowy sky carries on as the word's hero (full-bleed, 40pt bottom corners, the header floating on
// it, the word's first kanji drawn huge and faint behind it), the reading sits over the kanji as
// furigana, and one Kotori perches on the page, its mood saying what to expect (careful, happy,
// writing, asleep). The word's caution is a note Kotori has stamped 注意; Kotori's notes on a sense
// are speech from the bird; the meanings sit on a single paper sheet. Chips are soft-stone grammar
// keycaps, a separator, then Snow Pebbles (`SnowPebbles.tsx`). Rendered by `/entry/[id]`, and by
// `/proto/entry` with sample words and no API.
import type {
  Entry,
  EntryCaution,
  Example,
  Language,
  LabelSeverity,
  Sense,
  SimilarDifference,
  SimilarWord,
  UsagePattern,
  WordRef
} from "@kotori/contracts"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native"
import Animated, {
  Extrapolation,
  FadeIn,
  FadeInDown,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path } from "react-native-svg"
import { AudioButton } from "../components/AudioButton.tsx"
import { Button, IconButton } from "../components/Button.tsx"
import { Furigana } from "../components/Furigana.tsx"
import { Headword } from "../components/Headword.tsx"
import { Icon } from "../components/Icon.tsx"
import { KotoriMark, KotoriNotesBadge } from "../components/KotoriMark.tsx"
import { MarkedText } from "../components/MarkedText.tsx"
import { Mascot, type Mood } from "../components/Mascot.tsx"
import { PressableScale } from "../components/PressableScale.tsx"
import { Header } from "../components/Screen.tsx"
import { Snow } from "../components/Snow.tsx"
import { Text } from "../components/Text.tsx"
import { strings } from "../i18n/strings.ts"
import {
  CAUTION_ICON,
  contributors,
  hasKotoriMarks,
  labelItems,
  loanLine,
  senseCautions,
  similarWords,
  wordCautions
} from "../lib/entry.ts"
import { findForm } from "../lib/forms.ts"
import { useInterfaceLanguage, useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade, type Palette } from "../theme/tokens.ts"
import { protoHeroItems } from "./frequency.ts"
import { heroGrammarTags, senseGrammarTags } from "./grammar.ts"
import { alignReading } from "./ruby.ts"
import { GrammarTags, pebbleLift, SnowPebbleRow } from "./SnowPebbles.tsx"

/** Glosses run together as their language lists them: "to eat; to dine", "食べる、食事をする". */
const glossSeparator = (language: Language) => (language === "ja" ? "; " : "、")

/** How far the header reaches below the safe area, so the hero starts under it. */
const HEADER_HEIGHT = 46

/** A headword as large as fits: 64pt for short Japanese words and 52pt for short English ones, smaller for long ones. */
const headwordSize = (headword: string, language: Language) => {
  const length = Array.from(headword).length
  if (language === "en") return length <= 8 ? 52 : Math.max(30, Math.floor(420 / length))
  return length <= 4 ? 64 : Math.max(36, Math.floor(280 / length))
}

/** Who the page's facts came from, under it: "Sources: JMDict · Kotori". */
export const SourcesLine = ({ data }: { readonly data: Entry }) => {
  const { t } = useSession()
  return (
    <Text variant="caption" color="textFaint">
      <Text variant="caption" weight="semibold" color="textMuted" style={{ textDecorationLine: "underline" }}>
        {t.entry.sources}
      </Text>
      {t.entry.sourcesList(contributors(t, data))}
    </Text>
  )
}

/** The footer's key to Kotori's Notes: the lockup its chips and notes carry, and what it means. */
const KotoriLegend = () => {
  const { t } = useSession()
  return (
    <View style={{ gap: 3 }}>
      <KotoriNotesBadge title={t.entry.sourceKotori} tone="primary" compact />
      <Text variant="caption" color="textFaint" style={{ lineHeight: 16.5 }}>
        {t.entry.kotoriLegend}
      </Text>
    </View>
  )
}

const JAPANESE = /[぀-ヿ㐀-鿿]/

const KANJI = /[㐀-䶿一-鿿豈-﫿]/

/** The word's first kanji, for the faint giant behind it; a word in kana or English has none. */
const firstKanji = (headword: string) => Array.from(headword).find((char) => KANJI.test(char)) ?? null

const AiTag = ({ fg }: { readonly fg: string }) => (
  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: fade(fg, 0.12) }}>
    <Text variant="label" weight="bold" style={{ color: fg, fontSize: 9.5, lineHeight: 12, letterSpacing: 0.6 }}>
      AI
    </Text>
  </View>
)

const severityLook = (color: Palette, severity: LabelSeverity) =>
  ({
    quiet: { fg: color.textMuted, dot: null, tint: color.surfaceMuted },
    info: { fg: color.primaryDeep, dot: color.primaryDark, tint: color.primaryTint },
    warning: { fg: color.caution, dot: color.cautionMark, tint: color.cautionSoft },
    avoid: { fg: color.accent, dot: color.accent, tint: color.accentSoft }
  })[severity]

// ============================================================================
// Links to other words: the word in its own face, then an arrow
// ============================================================================

const WordLink = ({
  word,
  label,
  fg,
  onOpen
}: {
  readonly word: Pick<WordRef, "headword"> & { readonly entryId: WordRef["entryId"] | null }
  /** The link's whole text, with the word somewhere inside it ("Compare 食べる"). */
  readonly label: string
  readonly fg: string
  readonly onOpen: (id: number) => void
}) => {
  const at = label.indexOf(word.headword)
  const before = at < 0 ? label : label.slice(0, at)
  const after = at < 0 ? "" : label.slice(at + word.headword.length)
  const text = (part: string) =>
    part.length === 0 ? null : (
      <Text variant="caption" weight="semibold" style={{ color: fg, fontSize: 13.5, lineHeight: 20 }}>
        {part}
      </Text>
    )
  return (
    <PressableScale
      accessibilityRole={word.entryId === null ? undefined : "link"}
      accessibilityLabel={label}
      hitSlop={10}
      onPress={word.entryId === null ? undefined : () => onOpen(Number(word.entryId))}
      style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 2 }}
    >
      {text(before)}
      {at < 0 ? null : JAPANESE.test(word.headword) ? (
        <Text mincho size={16} style={{ color: fg, lineHeight: 20 }}>
          {word.headword}
        </Text>
      ) : (
        text(word.headword)
      )}
      {text(after)}
      <View style={{ marginLeft: 3 }}>
        <Icon name="arrow_forward" size={15} color={fg} />
      </View>
    </PressableScale>
  )
}

// ============================================================================
// The hero: the word in the snow
// ============================================================================

const HeroAudio = ({ audioUrl, demo }: { readonly audioUrl: string | null; readonly demo: boolean }) => {
  const { color } = useTheme()
  const { t } = useSession()
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
  if (audioUrl === null && !demo) return null
  const lift =
    Platform.OS === "web"
      ? { boxShadow: `0 10px 22px -12px ${fade(color.primaryDeep, 0.45)}` }
      : {
          shadowColor: color.primaryDeep,
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4
        }
  return (
    <View style={[{ borderRadius: 28 }, lift]}>
      {audioUrl !== null ? (
        <AudioButton url={audioUrl} size={54} />
      ) : (
        <IconButton
          icon="volume_up"
          label={t.common.listen}
          tone="surface"
          size={54}
          active={playing}
          onPress={() => {
            if (timer.current !== null) clearTimeout(timer.current)
            setPlaying(true)
            timer.current = setTimeout(() => setPlaying(false), 850)
          }}
        />
      )}
    </View>
  )
}

/**
 * A Japanese headword with its reading as furigana: each run of kanji carries its own kana,
 * centred right above it, and the kana the word is already written in carry none (食う: く over
 * 食; ご苦労様: くろうさま over 苦労様). A reading wider than its kanji overhangs the glyphs
 * beside it instead of pushing them apart, as ruby does in print.
 */
const RubyHeadword = ({
  headword,
  reading,
  size,
  lineHeight
}: {
  readonly headword: string
  readonly reading: string | null
  readonly size: number
  readonly lineHeight: number
}) => {
  const segments = reading === null ? [{ text: headword, reading: null }] : alignReading(headword, reading)
  // Large enough to read at a glance: a learner reads the kana before the kanji.
  const rubySize = Math.max(13, Math.round(size * 0.3))
  const rubyLine = Math.round(rubySize * 1.3)
  // Hina Mincho sits low in its line box: the readings tuck into the leading above the glyphs.
  const tuck = Math.round(size * 0.12)
  const hasRuby = segments.some((segment) => segment.reading !== null)
  // Keyed by where each run starts in the word, since a word can repeat a run (生き生き).
  const keyed = segments.map((segment, index) => ({
    ...segment,
    start: segments.slice(0, index).reduce((length, before) => length + before.text.length, 0)
  }))
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={reading === null ? headword : `${headword}, ${reading}`}
      style={{ flexDirection: "row", alignItems: "flex-end", paddingTop: hasRuby ? rubyLine - tuck : 0 }}
    >
      {keyed.map((segment) => (
        <View key={segment.start}>
          {segment.reading === null ? null : (
            <View
              pointerEvents="none"
              style={{ position: "absolute", left: -48, right: -48, bottom: lineHeight - tuck, alignItems: "center" }}
            >
              <Text
                jp
                weight="medium"
                size={rubySize}
                color="textMuted"
                numberOfLines={1}
                style={{ lineHeight: rubyLine, letterSpacing: 1 }}
              >
                {segment.reading}
              </Text>
            </View>
          )}
          <Text mincho size={size} selectable style={{ lineHeight, letterSpacing: size * 0.03 }}>
            {segment.text}
          </Text>
        </View>
      ))}
    </View>
  )
}

const Hero = ({
  data,
  top,
  desktop,
  demoAudio
}: {
  readonly data: Entry
  /** Room for the safe area and the header floating over the hero. */
  readonly top: number
  readonly desktop: boolean
  readonly demoAudio: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const ui = useInterfaceLanguage()
  const { width } = useWindowDimensions()
  const language = data.language
  const hasAudio = data.audioUrl !== null || demoAudio
  // As large as `headwordSize` allows, but never wrapping beside the speaker: Japanese glyphs are a
  // square em plus their tracking, Gabarito's bold lowercase a little over half an em.
  const room = Math.min(width, theme.maxWidth) - (desktop ? theme.space.lg * 2 : 0) - 48 - (hasAudio ? 54 + 14 : 0)
  const glyphs = Math.max(Array.from(data.headword).length, 1)
  const size = Math.min(
    headwordSize(data.headword, language),
    Math.floor(room / (glyphs * (language === "ja" ? 1.06 : 0.6)))
  )
  const lineHeight = Math.round(size * 1.12)
  const reading = data.reading.length > 0 && data.reading !== data.headword ? data.reading : null
  const grammar = heroGrammarTags(t, ui, data)
  const others = data.forms.filter(
    (form) => form.kind !== "inflection" && form.text !== data.headword && form.text !== data.reading
  )
  const inflections = data.forms.filter((form) => form.kind === "inflection")
  const origin = loanLine(t, data)
  const chips = protoHeroItems(t, ui, data)
  const giant = language === "ja" ? firstKanji(data.headword) : null

  return (
    <View
      style={{
        backgroundColor: theme.color.primaryTint,
        overflow: "hidden",
        paddingTop: top,
        paddingBottom: 30,
        paddingHorizontal: 24,
        ...(desktop
          ? { marginHorizontal: theme.space.lg, borderRadius: theme.radius.xl }
          : { borderBottomLeftRadius: 40, borderBottomRightRadius: 40 })
      }}
    >
      {giant === null ? null : (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", right: -36, bottom: -96 }}
        >
          <Text mincho size={260} style={{ lineHeight: 300, color: theme.color.surface, opacity: 0.55 }}>
            {giant}
          </Text>
        </View>
      )}
      <Snow />

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14 }}>
        <View style={{ flex: 1 }}>
          {language === "ja" ? (
            <RubyHeadword headword={data.headword} reading={reading} size={size} lineHeight={lineHeight} />
          ) : (
            <Headword language={language} size={size} selectable accessibilityRole="header" style={{ lineHeight }}>
              {data.headword}
            </Headword>
          )}
        </View>
        {hasAudio ? (
          <View style={{ marginBottom: Math.max(Math.round((lineHeight - 54) / 2), 0) }}>
            <HeroAudio audioUrl={data.audioUrl} demo={demoAudio} />
          </View>
        ) : null}
      </View>
      {language === "en" && reading !== null ? (
        <Text size={16} color="textMuted" selectable style={{ lineHeight: 22, marginTop: 2 }}>
          {reading}
        </Text>
      ) : null}

      {grammar.length > 0 || others.length > 0 || inflections.length > 0 || origin !== null ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <GrammarTags items={grammar} onTint />
          {others.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Text variant="caption" size={13} color="textFaint" style={{ lineHeight: 18 }}>
                {t.entry.forms}
              </Text>
              <Text mincho={language === "ja"} size={16} selectable style={{ lineHeight: 20 }}>
                {others.map((form) => form.text).join(language === "ja" ? "・" : ", ")}
              </Text>
            </View>
          ) : null}
          {inflections.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Text variant="caption" size={13} color="textFaint" style={{ lineHeight: 18 }}>
                {t.entry.inflections}
              </Text>
              <Text size={14} selectable style={{ lineHeight: 18 }}>
                {inflections.map((form) => form.text).join(", ")}
              </Text>
            </View>
          ) : null}
          {origin !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="swap_horiz" size={15} color={theme.color.textMuted} />
              <Text variant="caption" size={13} color="textMuted" selectable style={{ flex: 1, lineHeight: 18 }}>
                {origin}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {chips.length > 0 ? (
        <View style={{ marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: fade(theme.color.ink, 0.07) }}>
          <SnowPebbleRow items={chips} grammar={[]} onTint />
        </View>
      ) : null}
    </View>
  )
}

// ============================================================================
// Kotori on the page: perched on one card, speaking in the rest
// ============================================================================

/**
 * A drift of snow lying along a card's top edge, overhanging it, for Kotori to stand in: white like
 * the hero's flakes, with their faint outline. Drawn in a 120×24 box whose middle line is the edge.
 */
const SnowLedge = () => {
  const { color } = useTheme()
  return (
    <Svg width={120} height={24} viewBox="0 0 120 24" aria-hidden>
      <Path
        d="M3 14 C 2 9, 9 7, 16 8 C 21 3, 33 2, 41 6 C 48 1, 63 0, 71 5 C 79 1, 95 2, 101 7 C 109 6, 118 9, 117 14 C 116 18, 109 18, 104 17 C 101 21, 94 22, 91 18 C 80 19, 64 18, 52 18 C 47 22, 39 22, 36 18 C 27 19, 15 19, 9 18 C 5 18, 3 17, 3 14 Z"
        fill={color.surface}
        stroke={fade(color.primaryDark, 0.18)}
        strokeWidth={0.8}
      />
    </Svg>
  )
}

/**
 * Kotori standing on the top edge of `children`, on its right, as it stands on the search field;
 * on a `ledge` its feet sink into a drift of snow. `clear` leaves room above for its head when a
 * card, not the sky, is right above.
 */
const Perched = ({
  mood,
  size = 60,
  clear = false,
  ledge = false,
  children
}: {
  readonly mood: Mood
  readonly size?: number
  readonly clear?: boolean
  readonly ledge?: boolean
  readonly children: ReactNode
}) => (
  <View style={clear ? { marginTop: Math.round(size * 0.55) } : undefined}>
    {children}
    {/* The drawing's feet end 88% down its box, so this sets them on the card's edge. */}
    <View
      pointerEvents="none"
      style={{ position: "absolute", right: 22, top: -Math.round(size * (ledge ? 0.92 : 0.87)) }}
    >
      <Mascot size={size} mood={mood} />
    </View>
    {ledge ? (
      <View pointerEvents="none" style={{ position: "absolute", right: 6, top: -12 }}>
        <SnowLedge />
      </View>
    ) : null}
  </View>
)

/**
 * 注意 ("take care") as a red rubber stamp, the kind an office presses onto a document: Kotori's
 * mark on a word to handle with care. Inked a little crooked, with a second, finer ring inside.
 */
const CautionStamp = () => {
  const { color } = useTheme()
  const ink = color.accent
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 52,
        height: 52,
        borderRadius: 26,
        borderWidth: 2.5,
        borderColor: fade(ink, 0.9),
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: "-12deg" }]
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 3,
          left: 3,
          right: 3,
          bottom: 3,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: fade(ink, 0.55)
        }}
      />
      <Text jp weight="bold" size={14} style={{ color: ink, lineHeight: 15, opacity: 0.92 }}>
        注
      </Text>
      <Text jp weight="bold" size={14} style={{ color: ink, lineHeight: 15, opacity: 0.92 }}>
        意
      </Text>
    </View>
  )
}

/** The word to compare with as a card of its own: the word in its face, its reading, an arrow to it. */
const CompareTile = ({ word, onOpen }: { readonly word: WordRef; readonly onOpen: (id: number) => void }) => {
  const theme = useTheme()
  const { t } = useSession()
  const label = t.entry.compare(word.headword)
  const at = label.indexOf(word.headword)
  const before = (at < 0 ? label : label.slice(0, at)).trim()
  const after = (at < 0 ? "" : label.slice(at + word.headword.length)).trim()
  const japanese = JAPANESE.test(word.headword)
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={label}
      scaleTo={0.98}
      onPress={() => onOpen(Number(word.entryId))}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: theme.color.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: fade(theme.color.accent, 0.12),
          paddingVertical: 9,
          paddingLeft: 14,
          paddingRight: 10
        },
        pebbleLift(theme.color.shadow)
      ]}
    >
      {before.length > 0 ? (
        <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
          {before}
        </Text>
      ) : null}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 8 }}>
        <Text
          mincho={japanese}
          weight={japanese ? undefined : "bold"}
          size={japanese ? 22 : 18}
          style={{ lineHeight: 30 }}
        >
          {word.headword}
        </Text>
        {word.reading.length > 0 && word.reading !== word.headword ? (
          <Text jp={japanese} variant="caption" color="textMuted">
            {word.reading}
          </Text>
        ) : null}
        {after.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {after}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: theme.color.accentSoft,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Icon name="arrow_forward" size={17} color={theme.color.accent} />
      </View>
    </PressableScale>
  )
}

/**
 * The word's own cautions as a note Kotori has stamped 注意: the stamp, what kind of trouble it is,
 * whose note it is, the teaching set large, and the word to compare with as a card to open. Kotori
 * stands on it, worried.
 */
const CautionNote = ({
  cautions,
  onOpen
}: {
  readonly cautions: ReadonlyArray<EntryCaution>
  readonly onOpen: (id: number) => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const only = cautions.length === 1 ? cautions[0] : undefined
  const kotori = cautions.some((caution) => caution.source === "kotori")
  return (
    <View
      style={{
        backgroundColor: theme.color.accentSoft,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: fade(theme.color.accent, 0.1),
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 18,
        gap: 14
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <CautionStamp />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="heading" accessibilityRole="header" style={{ color: theme.color.accent }}>
            {only === undefined ? t.entry.cautions : t.caution[only.kind]}
          </Text>
          {kotori ? <KotoriNotesBadge title={t.entry.sourceKotori} tone="accent" compact showMark={false} /> : null}
        </View>
      </View>
      {cautions.map((caution, index) => (
        <View
          key={caution.id}
          style={[
            { gap: 12 },
            index === 0 ? null : { borderTopWidth: 1, borderTopColor: fade(theme.color.accent, 0.12), paddingTop: 14 }
          ]}
        >
          {only === undefined ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={CAUTION_ICON[caution.kind]} size={16} color={theme.color.accent} />
              <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
                {t.caution[caution.kind]}
              </Text>
            </View>
          ) : null}
          <Text size={16} selectable style={{ lineHeight: 24, color: theme.color.text }}>
            {caution.text}
          </Text>
          {caution.about ? <CompareTile word={caution.about} onOpen={onOpen} /> : null}
        </View>
      ))}
    </View>
  )
}

/** A caution about one sense, inside it: small blush, its kind, the teaching, the word to compare with. */
const SenseCautions = ({
  cautions,
  onOpen
}: {
  readonly cautions: ReadonlyArray<EntryCaution>
  readonly onOpen: (id: number) => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  if (cautions.length === 0) return null
  return (
    <View
      style={{
        backgroundColor: theme.color.accentSoft,
        borderRadius: 16,
        paddingHorizontal: 13,
        paddingTop: 11,
        paddingBottom: 12,
        gap: 10
      }}
    >
      {cautions.map((caution, index) => (
        <View
          key={caution.id}
          style={[
            { gap: 4 },
            index === 0 ? null : { borderTopWidth: 1, borderTopColor: fade(theme.color.accent, 0.12), paddingTop: 10 }
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name={CAUTION_ICON[caution.kind]} size={15} color={theme.color.accent} />
            <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
              {t.caution[caution.kind]}
            </Text>
            {caution.source === "kotori" ? <AiTag fg={theme.color.accent} /> : null}
          </View>
          <Text size={14} selectable style={{ lineHeight: 20, color: theme.color.text }}>
            {caution.text}
          </Text>
          {caution.about ? (
            <WordLink
              word={caution.about}
              label={t.entry.compare(caution.about.headword)}
              fg={theme.color.accent}
              onOpen={onOpen}
            />
          ) : null}
        </View>
      ))}
    </View>
  )
}

/** One of Kotori's notes on a sense, as a message from Kotori: its face, then the bubble. */
const KotoriSays = ({ note, onOpen }: { readonly note: UsagePattern; readonly onOpen: (id: number) => void }) => {
  const theme = useTheme()
  const { t } = useSession()
  return (
    <View style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          marginTop: 1,
          backgroundColor: theme.color.surface,
          borderWidth: 1,
          borderColor: fade(theme.color.primaryDark, 0.14),
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <KotoriMark size={24} mood="happy" sparkle={false} />
      </View>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.color.primaryTint,
          borderRadius: 18,
          borderTopLeftRadius: 5,
          paddingHorizontal: 13,
          paddingTop: 9,
          paddingBottom: 11,
          gap: 4
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            variant="caption"
            weight="bold"
            style={{ color: theme.color.primaryDeep, fontSize: 12, lineHeight: 16, letterSpacing: 0.15 }}
          >
            {t.entry.kotoriNote}
          </Text>
          <AiTag fg={theme.color.primaryDeep} />
        </View>
        <Text variant="small" selectable style={{ color: theme.color.text, lineHeight: 20 }}>
          {note.text}
        </Text>
        {note.about ? (
          <View style={{ paddingTop: 2 }}>
            <WordLink
              word={note.about}
              label={t.entry.compare(note.about.headword)}
              fg={theme.color.primaryDark}
              onOpen={onOpen}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}

// ============================================================================
// Meanings: one sheet of paper, a sense after another
// ============================================================================

/** An example hung on a thread of sky: the sentence, its translation, any note and credit. */
const ExampleThread = ({
  example,
  language,
  mark
}: {
  readonly example: Example
  readonly language: Language
  readonly mark: string | undefined
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const english = language === "en"
  const note = english ? example.noteJa : example.note
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "stretch" }}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: theme.color.primarySoft }} />
      <View style={{ flex: 1, gap: 3, paddingVertical: 2 }}>
        {english ? (
          <>
            <MarkedText text={example.en} mark={mark} size={16.5} lineHeight={23} />
            <Text jp variant="small" color="textMuted">
              {example.ja}
            </Text>
          </>
        ) : (
          <>
            <Furigana
              text={example.ja}
              furigana={example.furigana}
              size={17}
              marks={mark ? [{ text: mark, kind: "highlight" }] : []}
            />
            <Text variant="small" color="textMuted">
              {example.en}
            </Text>
          </>
        )}
        {note ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 3 }}>
            <View style={{ paddingTop: 1 }}>
              <Icon name="info" size={14} color={theme.color.textFaint} />
            </View>
            <Text jp={english} variant="caption" color="textFaint" style={{ flex: 1 }}>
              {note}
            </Text>
          </View>
        ) : null}
        {example.source === "kotori" ? null : (
          <Text variant="caption" color="textFaint" style={{ marginTop: 2 }}>
            {t.entry.sourceName[example.source]}
          </Text>
        )}
      </View>
      <View style={{ alignSelf: "center" }}>
        <AudioButton url={english ? example.translationAudioUrl : example.audioUrl} size={38} />
      </View>
    </View>
  )
}

const SenseBlock = ({
  entry,
  sense,
  number,
  forms,
  heroTagLabels,
  saved,
  onToggleSave,
  onOpen
}: {
  readonly entry: Entry
  readonly sense: Sense
  readonly number: number
  /** Ways the headword is written or inflected, to find and mark it in examples. */
  readonly forms: ReadonlyArray<string>
  /** Grammar already said in the hero; a sense repeats only what differs. */
  readonly heroTagLabels: ReadonlySet<string>
  readonly saved: boolean
  /** Absent while a save or removal is in flight. */
  readonly onToggleSave: (() => void) | undefined
  readonly onOpen: (id: number) => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const ui = useInterfaceLanguage()
  const language = entry.language
  const [first, second, ...rest] = sense.glosses
  const separator = glossSeparator(language)
  const dictionaryPatterns = sense.usagePatterns.filter((pattern) => pattern.source !== "kotori")
  const kotoriPatterns = sense.usagePatterns.filter((pattern) => pattern.source === "kotori")
  const senseGrammar = senseGrammarTags(t, ui, sense, heroTagLabels)

  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: theme.color.primaryTint,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Text variant="caption" weight="bold" size={13} style={{ color: theme.color.primaryDeep, lineHeight: 16 }}>
          {number}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 3, paddingTop: number === 1 ? 0 : 1 }}>
            {/* The first meaning is the one most learners came for, so it reads first. */}
            <Text
              variant="heading"
              selectable
              style={number === 1 ? { fontSize: 20, lineHeight: 26, letterSpacing: -0.2 } : undefined}
            >
              {second ? `${first}${separator}${second}` : first}
            </Text>
            {rest.length > 0 ? (
              <Text variant="small" color="textMuted">
                {rest.join(separator)}
              </Text>
            ) : null}
          </View>
          <View style={{ marginTop: -9, marginRight: -10 }}>
            <IconButton
              icon="bookmark"
              filled={saved}
              size={40}
              label={saved ? t.saved.remove : t.entry.save}
              onPress={onToggleSave}
            />
          </View>
        </View>
        {sense.labels.length > 0 || senseGrammar.length > 0 ? (
          <SnowPebbleRow items={labelItems(t, sense.labels)} grammar={senseGrammar} onTint={false} />
        ) : null}
        {sense.appliesTo.length > 0 ? (
          <Text variant="caption" color="textFaint">
            {t.entry.appliesTo(sense.appliesTo.join("、"))}
          </Text>
        ) : null}
        {dictionaryPatterns.map((pattern) => (
          <View key={pattern.text} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <View style={{ paddingTop: 1 }}>
              <Icon name="arrow_right_alt" size={16} color={theme.color.textFaint} />
            </View>
            <Text variant="small" color="textMuted" selectable style={{ flex: 1 }}>
              {pattern.text}
            </Text>
          </View>
        ))}
        {sense.examples.length > 0 ? (
          <View style={{ gap: 12, paddingTop: 2 }}>
            {sense.examples.map((example) => (
              <ExampleThread
                key={example.id}
                example={example}
                language={language}
                mark={findForm(language === "ja" ? example.ja : example.en, forms, language)}
              />
            ))}
          </View>
        ) : null}
        {kotoriPatterns.map((pattern) => (
          <KotoriSays key={pattern.text} note={pattern} onOpen={onOpen} />
        ))}
        <SenseCautions cautions={senseCautions(entry.cautions, sense.index)} onOpen={onOpen} />
        {sense.antonyms.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 6 }}>
            <Text variant="caption" color="textFaint">
              {t.entry.antonyms}
            </Text>
            {sense.antonyms.map((ref) => (
              <WordLink
                key={ref.text}
                word={{ headword: ref.text, entryId: ref.entryId }}
                label={ref.text}
                fg={theme.color.primaryDark}
                onOpen={onOpen}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** A section's title in the interface language, with the target language's word beside it. */
const SectionTitle = ({ pick }: { readonly pick: (s: (typeof strings)["en"]) => string }) => {
  const ui = useInterfaceLanguage()
  const other = ui === "en" ? "ja" : "en"
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 9, paddingHorizontal: 6 }}>
      <Text variant="section" accessibilityRole="header">
        {pick(strings[ui])}
      </Text>
      <Text
        mincho={other === "ja"}
        size={other === "ja" ? 15 : 13}
        weight={other === "ja" ? undefined : "medium"}
        color="textFaint"
        style={{ lineHeight: 20 }}
      >
        {pick(strings[other])}
      </Text>
    </View>
  )
}

const differenceTone: Record<SimilarDifference, LabelSeverity> = {
  respectful: "info",
  humble: "info",
  more_casual: "warning",
  more_formal: "info",
  plain: "quiet",
  masculine: "warning",
  feminine: "warning",
  american: "quiet",
  british: "quiet",
  older: "avoid",
  similar: "quiet"
}

const SimilarRows = ({
  words,
  language,
  onOpen
}: {
  readonly words: ReadonlyArray<SimilarWord>
  readonly language: Language
  readonly onOpen: (id: number) => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.hairline,
          paddingHorizontal: 18,
          paddingVertical: 2
        },
        theme.shadow(1)
      ]}
    >
      {words.map((word, index) => {
        const look = severityLook(theme.color, differenceTone[word.difference])
        return (
          <PressableScale
            key={word.entryId}
            scaleTo={0.98}
            accessibilityRole="link"
            accessibilityLabel={`${word.headword}, ${t.entry.difference[word.difference]}, ${word.meaning}`}
            onPress={() => onOpen(Number(word.entryId))}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 13,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.color.divider
            }}
          >
            <View style={{ flex: 1, gap: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Headword language={language} size={language === "ja" ? 24 : 20} style={{ lineHeight: 30 }}>
                  {word.headword}
                </Headword>
                {word.reading.length > 0 && word.reading !== word.headword ? (
                  <Text jp={language === "ja"} variant="caption" color="textMuted">
                    {word.reading}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 8,
                    height: 22,
                    borderRadius: 999,
                    backgroundColor: look.tint
                  }}
                >
                  {look.dot === null ? null : (
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: look.dot }} />
                  )}
                  <Text variant="caption" weight="semibold" style={{ color: look.fg, fontSize: 12, lineHeight: 15 }}>
                    {t.entry.difference[word.difference]}
                  </Text>
                </View>
                <Text variant="small" color="textMuted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {word.meaning}
                </Text>
              </View>
            </View>
            <Icon name="chevron_right" size={22} color={theme.color.textFaint} />
          </PressableScale>
        )
      })}
    </View>
  )
}

// ============================================================================
// The page
// ============================================================================

/** The header over the hero: clear on the sky, then snow with the word as its title once scrolled. */
const FloatingHeader = ({
  scrollY,
  threshold,
  data,
  onBack,
  actions
}: {
  readonly scrollY: SharedValue<number>
  readonly threshold: number
  readonly data: Entry
  readonly onBack: () => void
  readonly actions: ReactNode
}) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const shade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [threshold - 48, threshold], [0, 1], Extrapolation.CLAMP)
  }))
  const rise = useAnimatedStyle(() => {
    const shown = interpolate(scrollY.get(), [threshold - 24, threshold + 8], [0, 1], Extrapolation.CLAMP)
    return { opacity: shown, transform: [{ translateY: (1 - shown) * 8 }] }
  })
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top }}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.color.background, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
          shade
        ]}
      />
      <View style={{ width: "100%", maxWidth: theme.maxWidth, alignSelf: "center", paddingHorizontal: theme.space.lg }}>
        <Header
          onBack={onBack}
          title={
            <Animated.View style={rise}>
              <Headword language={data.language} size={data.language === "ja" ? 21 : 19} numberOfLines={1}>
                {data.headword}
              </Headword>
            </Animated.View>
          }
          actions={actions}
        />
      </View>
    </View>
  )
}

export interface PerchEntryProps {
  readonly data: Entry
  /** Sense indexes saved to review. */
  readonly savedSenses: ReadonlySet<number>
  /** Saves the sense, or asks to remove it when it is saved. */
  readonly onToggleSave: (sense: Sense) => void
  /** A save or removal is in flight: the bookmarks stay, but wait. */
  readonly saveBusy?: boolean
  readonly onBack: () => void
  readonly onShare?: () => void
  /** Opens another entry: a word to compare, an opposite, a similar word. */
  readonly onOpen: (id: number) => void
  /** Kotori is writing this word's examples. */
  readonly waiting: boolean
  /** The dictionary's alone: nothing of Kotori's on it yet. */
  readonly plain: boolean
  readonly ask: { readonly pending: boolean; readonly done: boolean; readonly onPress: () => void }
  /** The sources line as a link to the entry's sources page (`SourcesLine` inside it); plain without. */
  readonly sources?: ReactNode
  /** A speaker that plays nothing, for sample entries without audio. */
  readonly demoAudio?: boolean
  /** Notices to show under the hero (a failed refresh). */
  readonly notices?: ReactNode
  /** Drawn after the page, inside the scroll (prototype controls). */
  readonly footer?: ReactNode
  /** Drawn over the page (dialogs, the prototype switcher). */
  readonly overlay?: ReactNode
  readonly bottomInset?: number
}

export const PerchEntry = ({
  data,
  savedSenses,
  onToggleSave,
  saveBusy = false,
  onBack,
  onShare,
  onOpen,
  waiting,
  plain,
  ask,
  sources,
  demoAudio = false,
  notices,
  footer,
  overlay,
  bottomInset = 40
}: PerchEntryProps) => {
  const theme = useTheme()
  const { t } = useSession()
  const ui = useInterfaceLanguage()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const desktop = width > theme.maxWidth
  const scrollY = useSharedValue(0)
  const [showAll, setShowAll] = useState(false)
  const language = data.language
  const size = headwordSize(data.headword, language)
  const top = insets.top + HEADER_HEIGHT + 8
  const threshold = top + size + (data.reading.length > 0 ? 24 : 0)
  const heroTagLabels = new Set(heroGrammarTags(t, ui, data).map((item) => item.label))
  const forms = [data.headword, ...data.forms.map((form) => form.text), ...(language === "ja" ? [data.reading] : [])]
  const senses = showAll ? data.senses : data.senses.slice(0, 3)
  const cautions = wordCautions(data.cautions)
  const similar = similarWords(data.senses)
  const column = { width: "100%" as const, maxWidth: theme.maxWidth, alignSelf: "center" as const }

  // One Kotori on the page, on the first card it has something to say about.
  const perch: "writing" | "cautions" | "meanings" | "asleep" = plain
    ? "asleep"
    : waiting
      ? "writing"
      : cautions.length > 0
        ? "cautions"
        : "meanings"

  const sheet = (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.hairline,
          paddingHorizontal: 18,
          paddingTop: 18
        },
        theme.shadow(1)
      ]}
    >
      {senses.map((sense, index) => (
        <Animated.View
          key={sense.index}
          entering={FadeInDown.delay(120 + index * 60).duration(350)}
          style={{
            paddingBottom: 18,
            ...(index === 0 ? {} : { borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: 18 })
          }}
        >
          <SenseBlock
            entry={data}
            sense={sense}
            number={index + 1}
            forms={forms}
            heroTagLabels={heroTagLabels}
            saved={savedSenses.has(sense.index)}
            onToggleSave={saveBusy ? undefined : () => onToggleSave(sense)}
            onOpen={onOpen}
          />
        </Animated.View>
      ))}
      {data.senses.length > 3 ? (
        <View style={{ borderTopWidth: 1, borderTopColor: theme.color.divider, paddingVertical: 6 }}>
          <Button
            variant="ghost"
            label={showAll ? t.common.less : `${t.common.more} (${data.senses.length - 3})`}
            onPress={() => setShowAll(!showAll)}
          />
        </View>
      ) : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + bottomInset }}
        onScroll={(event) => scrollY.set(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <View style={[column, desktop ? { paddingTop: insets.top + 8 } : null]}>
          <Animated.View entering={FadeIn.duration(300)}>
            <Hero data={data} top={desktop ? HEADER_HEIGHT + 8 : top} desktop={desktop} demoAudio={demoAudio} />
          </Animated.View>
        </View>

        <View style={[column, { paddingHorizontal: theme.space.lg, paddingTop: 22, gap: 22 }]}>
          {notices}

          {perch === "writing" ? (
            <Animated.View entering={FadeIn}>
              {/* Thinking, Kotori's thought bubble rises above its head, so it needs the room. */}
              <Perched mood="thinking" clear>
                <View
                  style={{
                    backgroundColor: theme.color.primaryTint,
                    borderRadius: theme.radius.lg,
                    paddingHorizontal: 18,
                    paddingVertical: 16
                  }}
                >
                  <Text variant="small" style={{ color: theme.color.primaryDeep }}>
                    {t.entry.writing}
                  </Text>
                </View>
              </Perched>
            </Animated.View>
          ) : null}

          {cautions.length > 0 ? (
            <Animated.View entering={FadeInDown.delay(60).duration(350)}>
              {perch === "cautions" ? (
                <Perched mood="oops" ledge>
                  <CautionNote cautions={cautions} onOpen={onOpen} />
                </Perched>
              ) : (
                <CautionNote cautions={cautions} onOpen={onOpen} />
              )}
            </Animated.View>
          ) : null}

          <View style={{ gap: 12 }}>
            <SectionTitle pick={(s) => (data.senses.length === 1 ? s.entry.meaning : s.entry.meanings)} />
            {perch === "meanings" ? <Perched mood="happy">{sheet}</Perched> : sheet}
          </View>

          {plain ? (
            <Perched mood="sleepy" clear>
              <View
                style={[
                  {
                    backgroundColor: theme.color.surface,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: theme.color.hairline,
                    padding: 18,
                    gap: 14
                  },
                  theme.shadow(1)
                ]}
              >
                <View style={{ gap: 4 }}>
                  <Text variant="strong" weight="bold" size={15}>
                    {t.entry.dictionaryOnly}
                  </Text>
                  <Text variant="small" color="textMuted">
                    {t.entry.dictionaryOnlyBody(data.headword)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-start" }}>
                  <Button
                    variant="soft"
                    icon={ask.done ? "check" : "auto_awesome"}
                    label={t.entry.ask}
                    loading={ask.pending}
                    disabled={ask.done}
                    onPress={ask.onPress}
                  />
                </View>
              </View>
            </Perched>
          ) : null}

          {similar.length > 0 ? (
            <View style={{ gap: 10 }}>
              <SectionTitle pick={(s) => s.entry.similar} />
              <Text variant="small" color="textMuted" style={{ paddingHorizontal: 6, marginTop: -4 }}>
                {t.entry.similarIntro(data.headword)}
              </Text>
              <SimilarRows words={similar} language={language} onOpen={onOpen} />
            </View>
          ) : null}

          <View style={{ paddingHorizontal: 6, gap: 10, paddingTop: 2 }}>
            {sources ?? <SourcesLine data={data} />}
            {hasKotoriMarks(data) ? <KotoriLegend /> : null}
          </View>

          {footer}
        </View>
      </ScrollView>

      <FloatingHeader
        scrollY={scrollY}
        threshold={threshold}
        data={data}
        onBack={onBack}
        actions={
          <>
            {data.senses[0] ? (
              <IconButton
                icon="bookmark"
                filled={savedSenses.has(data.senses[0].index)}
                label={savedSenses.has(data.senses[0].index) ? t.saved.remove : t.entry.save}
                onPress={saveBusy ? undefined : () => onToggleSave(data.senses[0]!)}
              />
            ) : null}
            {onShare ? (
              <IconButton
                icon={Platform.OS === "android" ? "share" : "ios_share"}
                label={t.entry.share}
                onPress={onShare}
              />
            ) : null}
          </>
        }
      />
      {overlay}
    </View>
  )
}
