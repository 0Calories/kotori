import type { Language, Register } from "@kotori/contracts"
import * as Clipboard from "expo-clipboard"
import { useState } from "react"
import { View } from "react-native"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { AudioButton } from "./AudioButton.tsx"
import { IconButton } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { Chip } from "./Chip.tsx"
import { Furigana } from "./Furigana.tsx"
import { Text } from "./Text.tsx"

/** A target-language phrase from the coach, which learners can hear and copy. */
export const PhraseCard = ({
  text,
  furigana,
  register,
  lines,
  highlight,
  label
}: {
  readonly text: string
  readonly furigana: string | null
  readonly register: Register
  /** Supporting notes shown under the phrase, in the learner's language. The first sits with the phrase. */
  readonly lines: ReadonlyArray<{ readonly label?: string; readonly text: string }>
  /** The best answer: shown larger. */
  readonly highlight?: boolean
  /** An overline above the phrase, such as "Natural". */
  readonly label?: string
}) => {
  const theme = useTheme()
  const { t, profile } = useSession()
  const target: Language = profile?.targetLanguage ?? "ja"
  const [copied, setCopied] = useState(false)
  const [first, ...rest] = lines.filter((line) => line.text.length > 0)
  const size = highlight ? 22 : 18

  return (
    <Card style={{ gap: theme.space.md, paddingTop: theme.space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {label ? (
          <Text variant="label" style={{ color: theme.color.primaryDark }}>
            {label.toUpperCase()}
          </Text>
        ) : null}
        <Chip label={t.check.register[register]} />
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", marginRight: -6 }}>
          <IconButton
            icon={copied ? "check" : "content_copy"}
            label={copied ? t.common.copied : t.common.copy}
            size={38}
            onPress={async () => {
              await Clipboard.setStringAsync(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          />
        </View>
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
            <Furigana text={text} furigana={furigana} size={size} lineHeight={Math.round(size * 1.7)} />
          ) : (
            <Text
              variant="heading"
              size={size}
              weight="semibold"
              style={{ lineHeight: Math.round(size * 1.35) }}
              selectable
            >
              {text}
            </Text>
          )}
          {first && !first.label ? (
            <Text variant={highlight ? "body" : "small"} color="textMuted" style={{ lineHeight: 19 }}>
              {first.text}
            </Text>
          ) : null}
        </View>
        <AudioButton speak={{ text, language: target }} />
      </View>
      {(first?.label ? [first, ...rest] : rest).map((line) => (
        <View key={`${line.label ?? ""}${line.text}`} style={{ gap: 2, paddingHorizontal: 2 }}>
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
    </Card>
  )
}
