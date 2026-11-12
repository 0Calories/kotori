import type { EntryCaution } from "@kotori/contracts"
import { View } from "react-native"
import { CAUTION_ICON } from "../lib/entry.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Card } from "./Card.tsx"
import { Icon } from "./Icon.tsx"
import { Text } from "./Text.tsx"
import { CompareLink } from "./UsagePatterns.tsx"

/** One caution: its kind as an overline, the teaching, and the word to compare with. */
const CautionRow = ({ caution }: { readonly caution: EntryCaution }) => {
  const theme = useTheme()
  const { t } = useSession()
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
  if (cautions.length === 0) return null
  return (
    <Card tone="accent" padded={headline} style={headline ? { gap: 12 } : { gap: 12, padding: 12 }}>
      {headline ? (
        <Text
          variant="label"
          accessibilityRole="header"
          style={{ color: theme.color.accent, textTransform: "uppercase" }}
        >
          {t.entry.cautions}
        </Text>
      ) : null}
      {cautions.map((caution) => (
        <CautionRow key={caution.id} caution={caution} />
      ))}
    </Card>
  )
}
