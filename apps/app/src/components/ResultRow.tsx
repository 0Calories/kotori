import type { EntrySummary } from "@kotori/contracts"
import { Pressable, View } from "react-native"
import { posLabel } from "../i18n/strings.ts"
import { labelItems, resultLabels } from "../lib/entry.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { AudioButton } from "./AudioButton.tsx"
import { Chip } from "./Chip.tsx"
import { Headword } from "./Headword.tsx"
import { Icon } from "./Icon.tsx"
import { LabelTag } from "./LabelChips.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

/**
 * A dictionary entry in a list of search results: headword, reading, meanings and what sets it apart,
 * with a button to hear it said. The button sits beside the link, not inside it, so a tap plays without opening.
 */
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
  const labels = labelItems(t, resultLabels(entry.labels))
  const draft = entry.review === "unreviewed"
  // A stored clip when there is one; otherwise voiced on demand, from the kana for a Japanese word.
  const speak = {
    text: entry.language === "ja" && entry.reading.length > 0 ? entry.reading : entry.headword,
    language: entry.language
  }
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
          {draft || entry.inflection.length > 0 || entry.common || pos || labels.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {/* Kotori drafted it and no one has checked it yet: search lists it after every approved word. */}
              {draft ? <Chip tone="accent" icon="auto_awesome" label={t.dictionary.askDraft} /> : null}
              {entry.inflection.length > 0 ? (
                <Chip
                  tone="primary"
                  icon="call_split"
                  label={t.dictionary.inflected(entry.inflection.map((i) => t.inflection[i] ?? i).join(" · "))}
                />
              ) : null}
              {entry.common ? <Chip label={t.dictionary.common} /> : null}
              {pos ? <Chip label={pos} /> : null}
              {labels.map((item) => (
                <LabelTag key={item.key} item={item} />
              ))}
            </View>
          ) : null}
        </View>
      </PressableScale>
      <AudioButton url={entry.audioUrl} speak={speak} size={38} />
      {/* Part of the link to the eye, so it opens the entry too, but not a second stop for screen readers. */}
      <Pressable onPress={onPress} accessible={false} focusable={false} hitSlop={8} style={{ paddingVertical: 14 }}>
        <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
      </Pressable>
    </View>
  )
}
