/**
 * PROTOTYPE. The cases for the proposed dictionary model, grouped by direction. Each row says what
 * it tests. Reachable at /proto without signing in; see `src/proto`.
 */
import { useRouter } from "expo-router"
import { View } from "react-native"
import { Card } from "../../src/components/Card.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { Text } from "../../src/components/Text.tsx"
import { entries } from "../../src/proto/mock.ts"
import type { Entry } from "../../src/proto/model.ts"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const Row = ({ entry, last }: { readonly entry: Entry; readonly last: boolean }) => {
  const theme = useTheme()
  const router = useRouter()
  const kotori =
    entry.pitfalls.length > 0 ||
    entry.senses.some((sense) => sense.examples.some((example) => example.source === "kotori"))
  return (
    <PressableScale
      scaleTo={0.98}
      accessibilityRole="link"
      onPress={() => router.push({ pathname: "/proto/[id]", params: { id: String(entry.id) } })}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.divider
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Headword language={entry.language} size={entry.language === "ja" ? 23 : 20} style={{ lineHeight: 28 }}>
            {entry.headword}
          </Headword>
          <Text variant="caption" color="textMuted">
            {entry.senses[0]?.glosses[0]}
          </Text>
          {kotori ? <Icon name="auto_awesome" size={14} color={theme.color.primaryDark} /> : null}
        </View>
        <Text variant="caption" color="textFaint">
          {entry.tests}
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
    </PressableScale>
  )
}

const Group = ({ title, items }: { readonly title: string; readonly items: ReadonlyArray<Entry> }) => {
  const theme = useTheme()
  return (
    <Section title={title}>
      <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
        {items.map((entry, index) => (
          <Row key={entry.id} entry={entry} last={index === items.length - 1} />
        ))}
      </Card>
    </Section>
  )
}

export default function ProtoIndex() {
  const ja = entries.filter((entry) => entry.language === "ja")
  const en = entries.filter((entry) => entry.language === "en")
  return (
    <Screen bottomInset={40}>
      <View style={{ gap: 6, paddingHorizontal: 6 }}>
        <Text variant="title">Entry page prototype</Text>
        <Text variant="small" color="textMuted">
          The proposed data model on real words: labels from the dictionary, patterns, examples with their source,
          pitfalls, and evidence of use. Mock data, no API. Each row says what the case is for.
        </Text>
      </View>
      <Group title="Learning Japanese (English interface)" items={ja} />
      <Group title="英語を学ぶ（日本語インターフェース）" items={en} />
    </Screen>
  )
}
