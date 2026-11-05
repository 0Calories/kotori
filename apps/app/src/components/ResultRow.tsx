import type { EntrySummary } from "@kotori/contracts"
import { View } from "react-native"
import { posLabel } from "../i18n/strings.ts"
import { currencyTone, formalityTone } from "../lib/tones.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Chip } from "./Chip.tsx"
import { Headword } from "./Headword.tsx"
import { Icon } from "./Icon.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

/** A dictionary entry in a list of search results: headword, reading, meanings and what sets it apart. */
export const ResultRow = ({
  entry,
  first,
  onPress
}: {
  readonly entry: EntrySummary
  readonly first: boolean
  readonly onPress: () => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const pos = posLabel(t, entry.partOfSpeech)
  const currency = entry.currency && entry.currency !== "current" ? entry.currency : null
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="link"
      accessibilityLabel={`${entry.headword}, ${entry.meanings.join(", ")}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.divider
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
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
        {entry.inflection.length > 0 ||
        entry.common ||
        pos ||
        currency ||
        (entry.formality && entry.formality !== "neutral") ? (
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
            {entry.formality && entry.formality !== "neutral" ? (
              <Chip tone={formalityTone[entry.formality]} label={t.nuance.scale[entry.formality]} />
            ) : null}
            {currency ? <Chip tone={currencyTone[currency]} label={t.nuance.currency[currency]} /> : null}
          </View>
        ) : null}
      </View>
      <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
    </PressableScale>
  )
}
