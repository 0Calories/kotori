import type { Example } from "@kotori/domain"
import { View } from "react-native"
import { useSession } from "../session/SessionProvider.tsx"
import { theme } from "../theme/tokens.ts"
import { AudioButton } from "./AudioButton.tsx"
import { Furigana } from "./Furigana.tsx"
import { Text } from "./Text.tsx"

/** One example sentence, led and spoken in the language being learned, with the learner's own as its translation. */
export const ExampleRow = ({ example, mark }: { readonly example: Example; readonly mark?: string | undefined }) => {
  const { profile } = useSession()
  // Japanese speakers are learning the English side, so it leads, is the one spoken, and gets their note.
  const english = profile?.targetLanguage === "en"
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
        {note ? (
          <Text variant="caption" color="textFaint">
            {note}
          </Text>
        ) : null}
      </View>
      <AudioButton url={english ? example.translationAudioUrl : example.audioUrl} />
    </View>
  )
}
