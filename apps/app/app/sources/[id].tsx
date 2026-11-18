import { useLocalSearchParams, useRouter } from "expo-router"
import { View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { useEntry } from "../../src/api/queries.ts"
import { Card } from "../../src/components/Card.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Notice } from "../../src/components/Notice.tsx"
import { Header, Screen } from "../../src/components/Screen.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { useReadingPhase } from "../../src/lib/readingPhase.ts"
import { entryAttributions, entryIdFromParam } from "../../src/lib/sources.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

/** Dictionary and model credits for one entry. Opened from Sources on the entry, on web and native. */
export default function SourcesScreen() {
  const theme = useTheme()
  const { t } = useSession()
  const router = useRouter()
  const { id: raw } = useLocalSearchParams<{ id?: string | string[] }>()
  const id = entryIdFromParam(raw)
  const entry = useEntry(id ?? 0)
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"))
  const header = <Header onBack={back} title={t.entry.sources} />
  const kotoriReading = useReadingPhase(id !== null && !entry.isLoadingError && !entry.data) === "reading"

  // A failed refetch keeps the entry already loaded: only a first load that failed has nothing to show.
  if (id === null || entry.isLoadingError) {
    return (
      <Screen bottomInset={40} header={header}>
        <ErrorState error={entry.error} onRetry={id === null ? undefined : () => entry.refetch()} />
      </Screen>
    )
  }
  if (!entry.data || kotoriReading) {
    return (
      <Screen bottomInset={40} header={header}>
        {kotoriReading ? <MascotMessage mood="reading" /> : null}
      </Screen>
    )
  }

  const data = entry.data
  const rows = entryAttributions(t, data)
  return (
    <Screen bottomInset={40} header={header}>
      {entry.isRefetchError ? (
        <Notice
          message={t.common.notRefreshed}
          action={{ label: t.common.retry, onPress: () => void entry.refetch() }}
        />
      ) : null}
      <Animated.View entering={FadeIn.duration(250)} style={{ gap: theme.space.lg }}>
        <View style={{ gap: 6, paddingHorizontal: 6 }}>
          <Headword language={data.language} size={data.language === "ja" ? 36 : 30} selectable>
            {data.headword}
          </Headword>
          <Text variant="small" color="textMuted">
            {t.entry.sourcesIntro}
          </Text>
        </View>
        {rows.map((row) => (
          <Card key={row.id} style={{ gap: 6 }}>
            <Text variant="strong">{row.title}</Text>
            <Text variant="small" color="textMuted">
              {row.body}
            </Text>
          </Card>
        ))}
      </Animated.View>
    </Screen>
  )
}
