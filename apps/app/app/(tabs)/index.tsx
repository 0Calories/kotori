import Ionicons from "@expo/vector-icons/Ionicons"
import type { EntrySummary } from "@kotori/domain"
import { Link, useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { TextInput, View } from "react-native"
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated"
import { useQueue, useSearch, useStats } from "../../src/api/queries.ts"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { posLabel, type Strings } from "../../src/i18n/strings.ts"
import { formalityTone } from "../../src/lib/tones.ts"
import { usePreference } from "../../src/session/preferences.ts"
import { useT } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const useDebounced = (value: string, delay: number) => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const greeting = (t: Strings) => {
  const hour = new Date().getHours()
  return hour < 11 ? t.greeting.morning : hour < 18 ? t.greeting.afternoon : t.greeting.evening
}

const ResultRow = ({ entry, onPress }: { readonly entry: EntrySummary; readonly onPress: () => void }) => {
  const t = useT()
  const theme = useTheme()
  const pos = posLabel(t, entry.partOfSpeech)
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="link"
      accessibilityLabel={`${entry.headword}, ${entry.meanings.join(", ")}`}
    >
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <Text jp variant="title" style={{ fontSize: 24 }}>
              {entry.headword}
            </Text>
            {entry.reading !== entry.headword ? (
              <Text jp color="textMuted">
                {entry.reading}
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={2}>{entry.meanings.join("; ")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {entry.inflection.length > 0 ? (
              <Chip
                tone="rose"
                icon="git-branch-outline"
                label={t.dictionary.inflected(entry.inflection.map((i) => t.inflection[i] ?? i).join(" · "))}
              />
            ) : null}
            {entry.common ? <Chip tone="matcha" label={t.dictionary.common} /> : null}
            {pos ? <Chip label={pos} /> : null}
            {entry.formality && entry.formality !== "neutral" ? (
              <Chip tone={formalityTone[entry.formality]} label={t.nuance.scale[entry.formality]} />
            ) : null}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.color.textFaint} />
      </Card>
    </PressableScale>
  )
}

const ReviewTeaser = () => {
  const t = useT()
  const router = useRouter()
  const queue = useQueue()
  const stats = useStats()
  const due = queue.data ? queue.data.counts.new + queue.data.counts.learning + queue.data.counts.review : 0
  if (!queue.data) return null
  return (
    <Animated.View entering={FadeInDown.duration(400)}>
      <Card tone={due > 0 ? "primary" : "muted"} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Mascot size={64} mood={due > 0 ? "curious" : "sleepy"} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="strong">{due > 0 ? t.dictionary.reviewCard(due) : t.dictionary.reviewCardNone}</Text>
          {stats.data && stats.data.streak > 0 ? (
            <Chip tone="yuzu" icon="flame" label={t.dictionary.streak(stats.data.streak)} />
          ) : null}
        </View>
        {due > 0 ? (
          <Button label={t.dictionary.startReview} size="sm" onPress={() => router.push("/review/session")} />
        ) : null}
      </Card>
    </Animated.View>
  )
}

export default function DictionaryScreen() {
  const t = useT()
  const theme = useTheme()
  const router = useRouter()
  const input = useRef<TextInput>(null)
  const [query, setQuery] = useState("")
  const [recent, setRecent] = usePreference<ReadonlyArray<string>>("recent-searches", [])
  const debounced = useDebounced(query.trim(), 220)
  const search = useSearch(debounced)
  const searching = query.trim().length > 0

  const remember = (term: string) => setRecent([term, ...recent.filter((r) => r !== term)].slice(0, 8))

  const open = (entry: EntrySummary) => {
    remember(debounced)
    router.push({ pathname: "/entry/[id]", params: { id: String(entry.id) } })
  }

  const results = search.data
  const tips = useMemo(() => t.dictionary.tips, [t])

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Mascot size={52} mood={searching ? "thinking" : "curious"} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" color="textMuted">
            {greeting(t)}
          </Text>
          <Text variant="title">{t.tabs.dictionary}</Text>
        </View>
        <Link href="/settings" asChild>
          <IconButton icon="settings-outline" label="Settings" />
        </Link>
      </View>

      <View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: theme.color.surface,
            borderRadius: theme.radius.lg,
            borderWidth: 1.5,
            borderColor: searching ? theme.color.primary : theme.color.border,
            paddingHorizontal: 16,
            height: 56
          },
          theme.shadow(searching ? 2 : 1)
        ]}
      >
        <Ionicons name="search" size={20} color={searching ? theme.color.primary : theme.color.textFaint} />
        <TextInput
          ref={input}
          value={query}
          onChangeText={setQuery}
          placeholder={t.dictionary.placeholder}
          placeholderTextColor={theme.color.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t.dictionary.placeholder}
          style={[
            { flex: 1, fontSize: 17, color: theme.color.text, fontFamily: theme.font.medium, height: "100%" },
            { outlineStyle: "none" } as object
          ]}
        />
        {searching ? (
          <PressableScale onPress={() => setQuery("")} accessibilityLabel={t.common.close} hitSlop={10}>
            <Ionicons name="close-circle" size={20} color={theme.color.textFaint} />
          </PressableScale>
        ) : null}
      </View>

      {searching ? (
        <View style={{ gap: theme.space.md }}>
          {results?.mode === "romaji" && results.reading ? (
            <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 4 }}>
              {t.dictionary.romajiNotice(results.reading)}
            </Text>
          ) : null}
          {search.isError ? <ErrorState error={search.error} onRetry={() => search.refetch()} /> : null}
          {results && results.entries.length === 0 && !search.isFetching ? (
            <MascotMessage mood="oops" body={t.dictionary.noResults} size={90} />
          ) : null}
          {results?.entries.map((entry, index) => (
            <Animated.View
              key={entry.id}
              entering={FadeIn.delay(Math.min(index, 8) * 25).duration(200)}
              layout={LinearTransition.duration(180)}
            >
              <ResultRow entry={entry} onPress={() => open(entry)} />
            </Animated.View>
          ))}
        </View>
      ) : (
        <>
          <ReviewTeaser />
          {recent.length > 0 ? (
            <Section
              title={t.dictionary.recent}
              action={
                <PressableScale onPress={() => setRecent([])}>
                  <Text variant="caption" color="primary">
                    {t.dictionary.clearRecent}
                  </Text>
                </PressableScale>
              }
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {recent.map((term) => (
                  <PressableScale
                    key={term}
                    onPress={() => setQuery(term)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: theme.color.surface,
                      borderWidth: 1,
                      borderColor: theme.color.border
                    }}
                  >
                    <Text jp variant="small">
                      {term}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </Section>
          ) : null}
          <Section title={t.dictionary.tipsTitle}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {tips.map((tip) => (
                <PressableScale
                  key={tip}
                  onPress={() => setQuery(tip)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: theme.color.primarySoft
                  }}
                >
                  <Text jp variant="small" color="primary">
                    {tip}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </Section>
        </>
      )}
    </Screen>
  )
}
