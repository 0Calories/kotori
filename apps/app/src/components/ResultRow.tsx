import type { EntrySummary, Language } from "@kotori/contracts"
import { useEffect, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { posLabel } from "../i18n/strings.ts"
import { type ChipItem, labelItems, resultLabels } from "../lib/entry.ts"
import { pebbleLift, SnowPebbleFace } from "../proto/ChipVariants.tsx"
import { useChipVariant } from "../proto/chipVariant.tsx"
import {
  deriveSummaryFrequencyTier,
  type FrequencyTier,
  frequencyTierChip,
  withoutRedundantFrequencyLabels
} from "../proto/frequency.ts"
import { basePosLabel } from "../proto/grammar.ts"
import { useInterfaceLanguage, useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { AudioButton } from "./AudioButton.tsx"
import { IconButton } from "./Button.tsx"
import { Chip } from "./Chip.tsx"
import { Headword } from "./Headword.tsx"
import { Icon } from "./Icon.tsx"
import { LabelTag } from "./LabelChips.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

const ResultRowAudio = ({
  url,
  speak,
  demoAudio
}: {
  readonly url: string | null
  readonly speak: { readonly text: string; readonly language: Language }
  readonly demoAudio: boolean
}) => {
  const { color } = useTheme()
  const { t } = useSession()
  const [demoPlaying, setDemoPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    []
  )

  const triggerDemo = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setDemoPlaying(true)
    timerRef.current = setTimeout(() => setDemoPlaying(false), 850)
  }

  return (
    <View style={[{ borderRadius: 18 }, pebbleLift(color.shadow)]}>
      {demoAudio && !url ? (
        <IconButton
          icon="volume_up"
          label={t.common.listen}
          tone="surface"
          size={36}
          active={demoPlaying}
          onPress={triggerDemo}
        />
      ) : (
        <AudioButton url={url} speak={speak} size={36} />
      )}
    </View>
  )
}

/**
 * A dictionary entry in a list of search results:
 * - Upper zone: `Headword`, `reading`, quiet base part of speech (`verb`, `noun`), and glosses,
 *   paired with a top-right audio button + chevron.
 * - Lower Snow-Tray: only the small decision subset that tells a learner whether to consider this
 *   alternative and how it differs — led by **5-tier Frequency first** (`Very common`, `Common`,
 *   `Uncommon`, `Rare`, `Archaic`), followed by an inflection match chip (`past form`, when
 *   applicable) and **at most one** primary differentiating usage label (`Casual [AI]`, `Respectful`).
 */
export const ResultRow = ({
  entry,
  first,
  onPress,
  demoAudio = false
}: {
  readonly entry: EntrySummary & { readonly frequencyTier?: FrequencyTier }
  readonly first: boolean
  readonly onPress: () => void
  readonly demoAudio?: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const uiLanguage = useInterfaceLanguage()
  const variant = useChipVariant()
  // A stored clip when there is one; otherwise voiced on demand, from the kana for a Japanese word.
  const speak = {
    text: entry.language === "ja" && entry.reading.length > 0 ? entry.reading : entry.headword,
    language: entry.language
  }

  if (variant === "OLD") {
    const pos = posLabel(t, entry.partOfSpeech)
    const oldLabels = labelItems(t, resultLabels(entry.labels))
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderTopWidth: first ? 0 : 1,
          borderTopColor: theme.color.divider
        }}
      >
        <PressableScale
          onPress={onPress}
          scaleTo={0.985}
          accessibilityRole="link"
          accessibilityLabel={`${entry.headword}, ${entry.meanings.join(", ")}`}
          style={{ flex: 1, paddingVertical: 14 }}
        >
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <Headword language={entry.language} size={entry.language === "ja" ? 24 : 21} style={{ lineHeight: 30 }}>
                {entry.headword}
              </Headword>
              {entry.reading.length > 0 && entry.reading !== entry.headword ? (
                <Text jp={entry.language === "ja"} variant="small" color="textMuted">
                  {entry.reading}
                </Text>
              ) : null}
            </View>
            <Text color="textMuted" numberOfLines={2}>
              {entry.meanings.join(entry.language === "ja" ? "; " : "、")}
            </Text>
            {entry.inflection.length > 0 || entry.common || pos || oldLabels.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {entry.inflection.length > 0 ? (
                  <Chip
                    tone="primary"
                    icon="call_split"
                    label={t.dictionary.inflected(entry.inflection.map((i) => t.inflection[i] ?? i).join(" · "))}
                  />
                ) : null}
                {entry.common ? <Chip label={t.dictionary.common} /> : null}
                {pos ? <Chip label={pos} /> : null}
                {oldLabels.map((item) => (
                  <LabelTag key={item.key} item={item} />
                ))}
              </View>
            ) : null}
          </View>
        </PressableScale>
        {demoAudio && !entry.audioUrl ? (
          <IconButton icon="volume_up" label={t.common.listen} tone="surface" size={38} onPress={() => {}} />
        ) : (
          <AudioButton url={entry.audioUrl} speak={speak} size={38} />
        )}
        <Pressable onPress={onPress} accessible={false} focusable={false} hitSlop={8} style={{ paddingVertical: 14 }}>
          <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
        </Pressable>
      </View>
    )
  }

  const reading = entry.reading.length > 0 && entry.reading !== entry.headword ? entry.reading : null
  const quietPos = basePosLabel(t, uiLanguage, entry.partOfSpeech)
  const meaningsText = entry.meanings.join(entry.language === "ja" ? "; " : "、")

  // Curated decision subset for the Snow-Tray:
  // 1. Frequency ALWAYS first (`Very common` / `Common` / `Uncommon` / `Rare` / `Archaic`)
  // 2. Inflection match (`past form`) only when the query matched an inflected form
  // 3. At most ONE primary differentiating usage label (`Casual [AI]`, `Respectful`, `Vulgar`)
  const freqPebble = frequencyTierChip(uiLanguage, deriveSummaryFrequencyTier(entry))
  const inflectionPebble: ChipItem | null =
    entry.inflection.length > 0
      ? {
          key: "inflection",
          label: t.dictionary.inflected(entry.inflection.map((i) => t.inflection[i] ?? i).join(" · ")),
          help: "",
          severity: "info",
          icon: "call_split"
        }
      : null
  const primaryDiffLabel = labelItems(t, resultLabels(withoutRedundantFrequencyLabels(entry.labels), 1))[0] ?? null
  const trayItems: ReadonlyArray<ChipItem> = [freqPebble, inflectionPebble, primaryDiffLabel].filter(
    (item): item is ChipItem => item !== null
  )

  return (
    <View
      style={{
        position: "relative",
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.divider
      }}
    >
      <PressableScale
        onPress={onPress}
        scaleTo={0.988}
        accessibilityRole="link"
        accessibilityLabel={`${entry.headword}, ${entry.meanings.join(", ")}`}
        style={{ paddingVertical: 14 }}
      >
        <View style={{ paddingRight: 72, minHeight: 34, justifyContent: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <Headword language={entry.language} size={entry.language === "ja" ? 24 : 21} style={{ lineHeight: 30 }}>
              {entry.headword}
            </Headword>
            {reading ? (
              <Text jp={entry.language === "ja"} variant="small" color="textMuted">
                {reading}
              </Text>
            ) : null}
            {quietPos ? (
              <Text variant="caption" color="textFaint">
                {reading ? `· ${quietPos}` : quietPos}
              </Text>
            ) : null}
          </View>
        </View>

        <Text color="textMuted" numberOfLines={2} style={{ marginTop: 3 }}>
          {meaningsText}
        </Text>

        <View
          style={{
            marginTop: 9,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 12,
            backgroundColor: fade(theme.color.primaryTint, 0.52),
            borderWidth: 1,
            borderColor: fade(theme.color.primaryDark, 0.09),
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6
          }}
        >
          {trayItems.map((item) => (
            <SnowPebbleFace key={item.key} item={item} onTint compact />
          ))}
        </View>
      </PressableScale>

      {/* Top-right speaker + chevron anchored beside the headword (outside the link so audio taps don't open). */}
      <View
        style={{
          position: "absolute",
          top: 12,
          right: -4,
          flexDirection: "row",
          alignItems: "center",
          gap: 2
        }}
      >
        <ResultRowAudio url={entry.audioUrl} speak={speak} demoAudio={demoAudio} />
        <Pressable
          onPress={onPress}
          accessible={false}
          focusable={false}
          hitSlop={8}
          style={{ width: 24, height: 36, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="chevron_right" size={20} color={theme.color.textFaint} />
        </Pressable>
      </View>
    </View>
  )
}
