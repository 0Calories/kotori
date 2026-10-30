import type { Example, Language } from "@kotori/domain"
import { View } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { AudioButton } from "./AudioButton.tsx"
import { Furigana } from "./Furigana.tsx"
import { Icon } from "./Icon.tsx"
import { MarkedText } from "./MarkedText.tsx"
import { Text } from "./Text.tsx"

/**
 * One example sentence, led and spoken in the word's language, the one being learned,
 * with the learner's own as its translation and note.
 */
export const ExampleRow = ({
  example,
  language,
  mark
}: {
  readonly example: Example
  /** The language of the entry the sentence illustrates. */
  readonly language: Language
  /** The word as it appears in the sentence, to mark it. */
  readonly mark?: string | undefined
}) => {
  const theme = useTheme()
  const english = language === "en"
  const note = english ? example.noteJa : example.note
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
            <MarkedText text={example.en} mark={mark} />
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
        {note ? (
          // Set apart from the translation above it, which it otherwise reads like.
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 4 }}>
            <View style={{ paddingTop: 1 }}>
              <Icon name="info" size={14} color={theme.color.textFaint} />
            </View>
            <Text jp={english} variant="caption" color="textFaint" style={{ flex: 1 }}>
              {note}
            </Text>
          </View>
        ) : null}
      </View>
      <AudioButton url={english ? example.translationAudioUrl : example.audioUrl} />
    </View>
  )
}
