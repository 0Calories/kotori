import type { DraftEntry, DraftSense, Language } from "@kotori/contracts"
import { LinearGradient } from "expo-linear-gradient"
import { useEffect, useState } from "react"
import { StyleSheet, View } from "react-native"
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming
} from "react-native-reanimated"
import { draftTagLabel, posLabel } from "../i18n/strings.ts"
import { draftHeadwordSize } from "../lib/ask.ts"
import { currencyTone } from "../lib/tones.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { easeOut } from "../theme/easing.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Card } from "./Card.tsx"
import { Chip } from "./Chip.tsx"
import { Headword } from "./Headword.tsx"
import { Snow } from "./Snow.tsx"
import { Text } from "./Text.tsx"

/** How wide the glint is that sweeps across a fresh draft's headword band. */
const GLINT = 72

/** How far the glint's slant reaches past its box, so it starts and ends wholly out of sight. */
const SLANT = 48

/** Even speed through the middle, so the glint is seen crossing rather than flashing past. */
const sweepEasing = Easing.bezier(0.4, 0, 0.6, 1)

/**
 * A glint that sweeps once across the band as a fresh draft lands, after the card has settled.
 * It waits for the band's width so it starts and ends out of sight; reduced motion skips it.
 */
const Glint = () => {
  const reduceMotion = useReducedMotion()
  const [width, setWidth] = useState(0)
  const sweep = useSharedValue(0)
  useEffect(() => {
    if (reduceMotion || width === 0) return
    sweep.set(withDelay(700, withTiming(1, { duration: 800, easing: sweepEasing })))
  }, [reduceMotion, sweep, width])
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -(GLINT + SLANT) + sweep.get() * (width + GLINT + SLANT * 2) }, { skewX: "-20deg" }]
  }))
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width === 0 || reduceMotion ? null : (
        <Animated.View style={[{ position: "absolute", top: -24, bottom: -24, left: 0, width: GLINT }, style]}>
          <LinearGradient
            colors={["rgba(255, 255, 255, 0)", "rgba(255, 255, 255, 0.65)", "rgba(255, 255, 255, 0)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
  )
}

/** The sense's number, as on an entry's sense cards: the first in ink-dark, the rest on tint. */
const SenseNumber = ({ number }: { readonly number: number }) => {
  const theme = useTheme()
  const first = number === 1
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: first ? theme.color.primaryDark : theme.color.primaryTint,
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <Text
        variant="caption"
        weight="bold"
        size={13}
        style={{ color: first ? theme.color.onPrimaryDark : theme.color.text, lineHeight: 16 }}
      >
        {number}
      </Text>
    </View>
  )
}

const DraftSenseRow = ({
  sense,
  number,
  language,
  shown
}: {
  readonly sense: DraftSense
  readonly number: number
  /** The headword's language; glosses and notes are in the other one. */
  readonly language: Language
  /** Labels already on the band (its currency), so a sense doesn't repeat them. */
  readonly shown: ReadonlyArray<string>
}) => {
  const { t } = useSession()
  const separator = language === "ja" ? "; " : "、"
  const [first, second, ...rest] = sense.glosses
  const pos = posLabel(t, sense.partOfSpeech)
  const repeated = new Set(shown.map((label) => label.toLowerCase()))
  const labels = [...new Set(sense.labels.map((code) => draftTagLabel(t, code)))].filter(
    (label) => !repeated.has(label.toLowerCase())
  )
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <SenseNumber number={number} />
      <View style={{ flex: 1, gap: 6, paddingTop: 1 }}>
        <Text variant="heading" selectable>
          {second ? `${first}${separator}${second}` : first}
        </Text>
        {rest.length > 0 ? <Text color="textMuted">{rest.join(separator)}</Text> : null}
        {pos || labels.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {pos ? <Chip label={pos} /> : null}
            {labels.map((label) => (
              <Chip key={label} label={label} />
            ))}
          </View>
        ) : null}
        {sense.note ? (
          <Text jp={language === "en"} variant="small" color="textMuted" selectable>
            {sense.note}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/**
 * Kotori's drafted entry, laid out like a small entry page: the headword on a snowy band
 * marked as an unchecked AI draft, then each sense. A `live` draft — one Kotori has just
 * written — lands as Kotori celebrates: the card drops in, its parts follow one by one, and a
 * glint crosses the band; a draft seen again simply fades in.
 */
export const DraftCard = ({
  draft,
  language,
  live
}: {
  readonly draft: DraftEntry
  /** The language of the word drafted. */
  readonly language: Language
  readonly live: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const size = draftHeadwordSize(draft.headword, language)
  const reading = draft.reading.length > 0 && draft.reading !== draft.headword ? draft.reading : null
  const currency = draft.currency === "current" ? null : draft.currency
  const currencyLabel = currency === null ? null : t.nuance.currency[currency]
  // Each part follows the one before it by a beat, after the card itself has landed.
  const step = (index: number) =>
    live
      ? FadeInDown.duration(380)
          .delay(260 + index * 80)
          .easing(easeOut)
      : undefined
  const inner = theme.radius.lg - 1

  return (
    <Animated.View
      entering={live ? FadeInDown.duration(420).delay(120).easing(easeOut) : FadeIn.duration(250)}
      accessibilityLabel={`${t.dictionary.askDraft}: ${draft.headword}`}
    >
      <Card padded={false}>
        <View
          style={{
            backgroundColor: theme.color.primaryTint,
            borderTopLeftRadius: inner,
            borderTopRightRadius: inner,
            overflow: "hidden",
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: 18,
            gap: 10
          }}
        >
          <Snow />
          <Chip tone="accent" icon="auto_awesome" label={t.dictionary.askDraft} />
          <Animated.View entering={step(0)} style={{ gap: 2 }}>
            <Headword
              language={language}
              size={size}
              selectable
              accessibilityRole="header"
              style={{ lineHeight: Math.round(size * (language === "ja" ? 1.3 : 1.15)) }}
            >
              {draft.headword}
            </Headword>
            {reading !== null || currencyLabel !== null ? (
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                {reading === null ? null : (
                  <Text jp={language === "ja"} variant="caption" size={14} color="textMuted" selectable>
                    {reading}
                  </Text>
                )}
                {currency === null ? null : <Chip tone={currencyTone[currency]} label={t.nuance.currency[currency]} />}
              </View>
            ) : null}
            {draft.spellings.length > 0 ? (
              <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
                {t.entry.forms}: {draft.spellings.join(language === "ja" ? "・" : ", ")}
              </Text>
            ) : null}
          </Animated.View>
          {live ? <Glint /> : null}
        </View>
        <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, gap: 18 }}>
          {draft.senses.map((sense, index) => (
            <Animated.View key={sense.glosses.join("\n")} entering={step(index + 1)}>
              <DraftSenseRow
                sense={sense}
                number={index + 1}
                language={language}
                shown={currencyLabel === null ? [] : [currencyLabel]}
              />
            </Animated.View>
          ))}
        </View>
      </Card>
    </Animated.View>
  )
}
