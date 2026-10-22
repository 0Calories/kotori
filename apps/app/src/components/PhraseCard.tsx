import type { Language, Register } from "@kotori/domain"
import * as Clipboard from "expo-clipboard"
import { useState } from "react"
import { View } from "react-native"
import { useAddNote } from "../api/queries.ts"
import { registerTone } from "../lib/tones.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { AudioButton } from "./AudioButton.tsx"
import { IconButton } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { Chip } from "./Chip.tsx"
import { Furigana } from "./Furigana.tsx"
import { Text } from "./Text.tsx"

/** A target-language phrase from the coach, which learners can hear, copy and save for review. */
export const PhraseCard = ({
  text,
  furigana,
  register,
  lines,
  meaning,
  source,
  highlight
}: {
  readonly text: string
  readonly furigana: string | null
  readonly register: Register
  /** Supporting notes shown under the phrase, in the learner's language. */
  readonly lines: ReadonlyArray<{ readonly label?: string; readonly text: string }>
  /** What the saved card asks the learner to produce. */
  readonly meaning: string
  readonly source: "how-to-say" | "naturalness"
  readonly highlight?: boolean
}) => {
  const theme = useTheme()
  const { t, profile } = useSession()
  const target: Language = profile?.targetLanguage ?? "ja"
  const addNote = useAddNote()
  const [copied, setCopied] = useState(false)
  const saved = addNote.isSuccess

  return (
    <Card
      style={{
        gap: theme.space.md,
        borderColor: highlight ? theme.color.primary : theme.color.border,
        borderWidth: highlight ? 2 : 1
      }}
    >
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Chip tone={registerTone[register]} label={t.check.register[register]} />
          {target === "ja" ? (
            <Furigana text={text} furigana={furigana} size={22} />
          ) : (
            <Text variant="heading" size={20} selectable>
              {text}
            </Text>
          )}
        </View>
        <AudioButton speak={{ text, language: target }} />
      </View>
      {lines.map((line, index) => (
        <View key={index} style={{ gap: 2 }}>
          {line.label ? (
            <Text variant="label" color="textFaint">
              {line.label.toUpperCase()}
            </Text>
          ) : null}
          <Text variant="small" color={line.label ? "text" : "textMuted"}>
            {line.text}
          </Text>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        <IconButton
          icon={copied ? "checkmark" : "copy-outline"}
          label={copied ? t.common.copied : t.common.copy}
          size={36}
          onPress={async () => {
            await Clipboard.setStringAsync(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        />
        <IconButton
          icon={saved ? "bookmark" : "bookmark-outline"}
          label={saved ? t.common.saved : t.common.save}
          tone="primary"
          active={saved}
          size={36}
          onPress={
            saved || addNote.isPending
              ? undefined
              : () =>
                  addNote.mutate({
                    content: {
                      kind: "phrase",
                      text,
                      furigana,
                      meaning,
                      note: lines.map((l) => l.text).join("\n") || null,
                      register,
                      source
                    },
                    templates: ["produce", "recognize"]
                  })
          }
        />
      </View>
    </Card>
  )
}
