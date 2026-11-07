import type { Pattern, WordRef } from "@kotori/contracts"
import { useRouter } from "expo-router"
import { View } from "react-native"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Chip } from "./Chip.tsx"
import { Icon } from "./Icon.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

/** A link to the word a note compares with: "Compare お疲れ様". */
export const CompareLink = ({
  word,
  tone = "neutral"
}: {
  readonly word: WordRef
  readonly tone?: "neutral" | "primary"
}) => {
  const { t } = useSession()
  const router = useRouter()
  return (
    <PressableScale
      accessibilityRole="link"
      onPress={() => router.push({ pathname: "/entry/[id]", params: { id: String(word.entryId) } })}
      style={{ alignSelf: "flex-start" }}
    >
      <Chip tone={tone} icon="arrow_forward" label={t.entry.compare(word.headword)} />
    </PressableScale>
  )
}

/**
 * How a sense is used. The dictionary's notes ("usu. to one's subordinate") are plain lines;
 * Kotori's context sits on a tint with the ✦ mark, beside them rather than as a warning, so the
 * learner can tell the editors' note from what Kotori added.
 */
export const Patterns = ({ patterns }: { readonly patterns: ReadonlyArray<Pattern> }) => {
  const theme = useTheme()
  if (patterns.length === 0) return null
  return (
    <View style={{ gap: 6 }}>
      {patterns.map((pattern) =>
        pattern.source === "kotori" ? (
          <View
            key={pattern.text}
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "flex-start",
              backgroundColor: theme.color.primaryTint,
              borderRadius: theme.radius.sm,
              paddingVertical: 8,
              paddingHorizontal: 10
            }}
          >
            <Text variant="caption" style={{ color: theme.color.primaryDeep, lineHeight: 19 }}>
              ✦
            </Text>
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="small" selectable style={{ color: theme.color.primaryDeep }}>
                {pattern.text}
              </Text>
              {pattern.about ? <CompareLink word={pattern.about} tone="primary" /> : null}
            </View>
          </View>
        ) : (
          <View key={pattern.text} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <View style={{ paddingTop: 1 }}>
              <Icon name="arrow_right_alt" size={16} color={theme.color.textFaint} />
            </View>
            <Text variant="small" color="textMuted" selectable style={{ flex: 1 }}>
              {pattern.text}
            </Text>
          </View>
        )
      )}
    </View>
  )
}
