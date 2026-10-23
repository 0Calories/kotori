import type { Language, Register } from "@kotori/domain"
import * as Clipboard from "expo-clipboard"
import { useState } from "react"
import { View } from "react-native"
import { useAddNote } from "../api/queries.ts"
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
  highlight,
  label
}: {
  readonly text: string
  readonly furigana: string | null
  readonly register: Register
  /** Supporting notes shown under the phrase, in the learner's language. The first sits with the phrase. */
  readonly lines: ReadonlyArray<{ readonly label?: string; readonly text: string }>
  /** What the saved card asks the learner to produce. */
  readonly meaning: string
  readonly source: "how-to-say" | "naturalness"
  /** The best answer: shown larger. */
  readonly highlight?: boolean
  /** An overline above the phrase, such as "Natural". */
  readonly label?: string
}) => {
  const theme = useTheme()
  const { t, profile } = useSession()
  const target: Language = profile?.targetLanguage ?? "ja"
  const addNote = useAddNote()
  const [copied, setCopied] = useState(false)
  const saved = addNote.isSuccess
  const [first, ...rest] = lines.filter((line) => line.text.length > 0)
  const size = highlight ? 22 : 18

  return (
    <Card style={{ gap: theme.space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          {label ? (
            <Text variant="label" style={{ color: theme.color.primaryDark }}>
              {label.toUpperCase()}
            </Text>
          ) : null}
        </View>
        <Chip label={t.check.register[register]} />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: theme.color.surfaceMuted,
          borderRadius: theme.radius.md,
          paddingVertical: 10,
          paddingLeft: 14,
          paddingRight: 8
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          {target === "ja" ? (
            <Furigana text={text} furigana={furigana} size={size} />
          ) : (
            <Text variant="heading" size={size} selectable>
              {text}
            </Text>
          )}
          {first && !first.label ? (
            <Text variant="small" color="textMuted">
              {first.text}
            </Text>
          ) : null}
        </View>
        <AudioButton speak={{ text, language: target }} />
      </View>
      {(first?.label ? [first, ...rest] : rest).map((line, index) => (
        <View key={index} style={{ gap: 2, paddingHorizontal: 2 }}>
          {line.label ? (
            <Text variant="label" color="textMuted">
              {line.label.toUpperCase()}
            </Text>
          ) : null}
          <Text variant="small" color={line.label ? "text" : "textMuted"}>
            {line.text}
          </Text>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 4, justifyContent: "flex-end", marginBottom: -6, marginRight: -6 }}>
        <IconButton
          icon={copied ? "check" : "content_copy"}
          label={copied ? t.common.copied : t.common.copy}
          size={40}
          onPress={async () => {
            await Clipboard.setStringAsync(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        />
        <IconButton
          icon="bookmark"
          label={saved ? t.common.saved : t.common.save}
          filled={saved}
          size={40}
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
