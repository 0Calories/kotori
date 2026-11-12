import type { EntryCaution } from "@kotori/contracts"
import { View } from "react-native"
import { CAUTION_ICON } from "../lib/entry.ts"
import { useChipVariant } from "../proto/chipVariant.tsx"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { Card } from "./Card.tsx"
import { Icon } from "./Icon.tsx"
import { KotoriNotesBadge } from "./KotoriMark.tsx"
import { Text } from "./Text.tsx"
import { CompareLink } from "./UsagePatterns.tsx"

/** One caution: its kind as an overline, the teaching, and the word to compare with. */
const CautionRow = ({
  caution,
  showInlineAttribution
}: {
  readonly caution: EntryCaution
  readonly showInlineAttribution: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const variant = useChipVariant()

  if (variant === "OLD") {
    return (
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ paddingTop: 1 }}>
          <Icon name={CAUTION_ICON[caution.kind]} size={18} color={theme.color.accent} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
            {caution.source === "kotori" ? `${t.caution[caution.kind]} ✦` : t.caution[caution.kind]}
          </Text>
          <Text variant="small" selectable>
            {caution.text}
          </Text>
          {caution.about ? (
            <View style={{ marginTop: 2 }}>
              <CompareLink word={caution.about} />
            </View>
          ) : null}
        </View>
      </View>
    )
  }

  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: "rgba(255, 255, 255, 0.78)",
          borderWidth: 1,
          borderColor: fade(theme.color.accent, 0.14),
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Icon name={CAUTION_ICON[caution.kind]} size={15.5} color={theme.color.accent} />
      </View>
      <View style={{ flex: 1, gap: 4, paddingTop: 1 }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6
          }}
        >
          <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
            {t.caution[caution.kind]}
          </Text>
          {showInlineAttribution && caution.source === "kotori" ? (
            <KotoriNotesBadge title={t.entry.kotoriNote} tone="accent" compact />
          ) : null}
        </View>
        <Text variant="small" selectable style={{ lineHeight: 19.5 }}>
          {caution.text}
        </Text>
        {caution.about ? (
          <View style={{ marginTop: 2 }}>
            <CompareLink word={caution.about} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/**
 * What would surprise a learner, on blush. The word's own sit under the hero headed "Cautions";
 * a sense's sit inside it, where the heading would only repeat the card above.
 */
export const Cautions = ({
  cautions,
  headline
}: {
  readonly cautions: ReadonlyArray<EntryCaution>
  readonly headline: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const variant = useChipVariant()
  if (cautions.length === 0) return null

  const anyKotori = cautions.some((caution) => caution.source === "kotori")
  const allKotori = cautions.every((caution) => caution.source === "kotori")
  const showHeaderAttribution = variant !== "OLD" && headline && anyKotori
  const showInlineAttribution = variant !== "OLD" && (!headline || !allKotori)

  return (
    <Card tone="accent" padded={headline} style={headline ? { gap: 12 } : { gap: 12, padding: 12 }}>
      {headline ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8
          }}
        >
          <Text
            variant="label"
            accessibilityRole="header"
            style={{ color: theme.color.accent, textTransform: "uppercase" }}
          >
            {t.entry.cautions}
          </Text>
          {showHeaderAttribution ? <KotoriNotesBadge title={t.entry.sourceKotori} tone="accent" compact /> : null}
        </View>
      ) : null}
      {cautions.map((caution) => (
        <CautionRow key={caution.id} caution={caution} showInlineAttribution={showInlineAttribution} />
      ))}
    </Card>
  )
}
