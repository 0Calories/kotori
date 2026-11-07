import type { WordPitfall } from "@kotori/contracts"
import { View } from "react-native"
import { PITFALL_ICON } from "../lib/entry.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Card } from "./Card.tsx"
import { Icon } from "./Icon.tsx"
import { CompareLink } from "./Patterns.tsx"
import { Text } from "./Text.tsx"

/** One pitfall: its kind as an overline, the teaching, and the word to compare with. */
const PitfallRow = ({ pitfall }: { readonly pitfall: WordPitfall }) => {
  const theme = useTheme()
  const { t } = useSession()
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 1 }}>
        <Icon name={PITFALL_ICON[pitfall.kind]} size={18} color={theme.color.accent} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
          {pitfall.source === "kotori" ? `${t.pitfall[pitfall.kind]} ✦` : t.pitfall[pitfall.kind]}
        </Text>
        <Text variant="small" selectable>
          {pitfall.text}
        </Text>
        {pitfall.about ? (
          <View style={{ marginTop: 2 }}>
            <CompareLink word={pitfall.about} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/**
 * What would surprise a learner, on blush. The word's own sit under the hero headed "Watch out";
 * a sense's sit inside it, where the heading would only repeat the card above.
 */
export const Pitfalls = ({
  pitfalls,
  headline
}: {
  readonly pitfalls: ReadonlyArray<WordPitfall>
  readonly headline: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  if (pitfalls.length === 0) return null
  return (
    <Card tone="accent" padded={headline} style={headline ? { gap: 12 } : { gap: 12, padding: 12 }}>
      {headline ? (
        <Text
          variant="label"
          accessibilityRole="header"
          style={{ color: theme.color.accent, textTransform: "uppercase" }}
        >
          {t.entry.watchOut}
        </Text>
      ) : null}
      {pitfalls.map((pitfall) => (
        <PitfallRow key={pitfall.id} pitfall={pitfall} />
      ))}
    </Card>
  )
}
