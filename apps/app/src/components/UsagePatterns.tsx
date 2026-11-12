import type { UsagePattern, WordRef } from "@kotori/contracts"
import { useRouter } from "expo-router"
import { View } from "react-native"
import { useChipVariant } from "../proto/chipVariant.tsx"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { Chip } from "./Chip.tsx"
import { Icon } from "./Icon.tsx"
import { KotoriMark, KotoriNotesBadge } from "./KotoriMark.tsx"
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

const KotoriNoteCard = ({ usagePattern }: { readonly usagePattern: UsagePattern }) => {
  const theme = useTheme()
  const { t } = useSession()
  const variant = useChipVariant()

  if (variant === "OLD") {
    return (
      <View
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
            {usagePattern.text}
          </Text>
          {usagePattern.about ? <CompareLink word={usagePattern.about} tone="primary" /> : null}
        </View>
      </View>
    )
  }

  // Locked-in Variant A: Mascot Portrait Speech-Note (`Kotori's Note [AI]`)
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
        backgroundColor: fade(theme.color.primaryTint, 0.86),
        borderRadius: 14,
        borderWidth: 1,
        borderColor: fade(theme.color.primaryDark, 0.12),
        paddingVertical: 10,
        paddingHorizontal: 11
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: fade(theme.color.ink, 0.06),
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1
        }}
      >
        <KotoriMark size={21} mood="happy" sparkle />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <KotoriNotesBadge title={t.entry.kotoriNote} tone="primary" compact showMark={false} />
        <Text variant="small" selectable style={{ color: theme.color.primaryDeep, lineHeight: 19.5 }}>
          {usagePattern.text}
        </Text>
        {usagePattern.about ? (
          <View style={{ paddingTop: 2 }}>
            <CompareLink word={usagePattern.about} tone="primary" />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/**
 * How a sense is used. `scope="dictionary"` renders only editorial dictionary qualifiers (kept
 * beside the gloss); `scope="kotori"` renders only Kotori's Notes (positioned below example
 * sentences); `scope="all"` renders both (used in `DraftCard` and the `OLD` baseline).
 */
export const UsagePatterns = ({
  usagePatterns,
  scope = "all"
}: {
  readonly usagePatterns: ReadonlyArray<UsagePattern>
  readonly scope?: "all" | "dictionary" | "kotori"
}) => {
  const theme = useTheme()
  const filtered =
    scope === "all"
      ? usagePatterns
      : scope === "kotori"
        ? usagePatterns.filter((item) => item.source === "kotori")
        : usagePatterns.filter((item) => item.source !== "kotori")

  if (filtered.length === 0) return null

  return (
    <View style={{ gap: 7 }}>
      {filtered.map((usagePattern) =>
        usagePattern.source === "kotori" ? (
          <KotoriNoteCard key={usagePattern.text} usagePattern={usagePattern} />
        ) : (
          <View key={usagePattern.text} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
            <View style={{ paddingTop: 1 }}>
              <Icon name="arrow_right_alt" size={16} color={theme.color.textFaint} />
            </View>
            <Text variant="small" color="textMuted" selectable style={{ flex: 1 }}>
              {usagePattern.text}
            </Text>
          </View>
        )
      )}
    </View>
  )
}
