import type { EntrySummary, Language } from "@kotori/contracts"
import { normalizeAsk } from "@kotori/language"
import { useRouter } from "expo-router"
import { useEffect, useRef, useState } from "react"
import { type TextInput, useWindowDimensions, View } from "react-native"
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAsks, useDueNotes, useSearch, useStats } from "../../src/api/queries.ts"
import { AskKotori } from "../../src/components/AskKotori.tsx"
import { Button } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { ResultRow } from "../../src/components/ResultRow.tsx"
import { Screen } from "../../src/components/Screen.tsx"
import { SearchField } from "../../src/components/SearchField.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { ErrorState } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { strings } from "../../src/i18n/strings.ts"
import { useReadingPhase } from "../../src/lib/readingPhase.ts"
import { usePreference } from "../../src/session/preferences.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const useDebounced = (value: string, delay: number) => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Kotori says hello in the language you're learning. */
const greeting = (target: Language, name: string | null) => {
  const hour = new Date().getHours()
  const words = strings[target].greeting
  const hello = hour < 11 ? words.morning : hour < 18 ? words.afternoon : words.evening
  return name === null ? hello : `${hello}${target === "ja" ? "、" : ", "}${name}`
}

/** How many recent searches to keep and show as chips under the search field. */
const MAX_RECENT = 6

const LANGUAGE_NAMES: Record<Language, { readonly short: string; readonly long: string }> = {
  en: { short: "EN", long: "English" },
  ja: { short: "日本語", long: "日本語" }
}

const ReviewTeaser = () => {
  const { t } = useSession()
  const router = useRouter()
  const dueNotes = useDueNotes()
  const stats = useStats()
  const due = dueNotes.data ? dueNotes.data.counts.new + dueNotes.data.counts.learning + dueNotes.data.counts.review : 0
  if (!dueNotes.data) return null
  return (
    <Animated.View entering={FadeInDown.duration(400)}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Mascot size={56} mood={due > 0 ? "neutral" : "sleepy"} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="strong">{due > 0 ? t.dictionary.reviewDue(due) : t.dictionary.reviewDueNone}</Text>
          {stats.data && stats.data.streak > 0 ? (
            <Chip tone="accent" icon="local_fire_department" label={t.dictionary.streak(stats.data.streak)} />
          ) : null}
        </View>
        {due > 0 ? (
          <Button label={t.dictionary.startReview} size="sm" onPress={() => router.push("/review/session")} />
        ) : null}
      </Card>
    </Animated.View>
  )
}

export default function LookUpScreen() {
  const theme = useTheme()
  const { t, profile } = useSession()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const desktop = width > theme.maxWidth
  const input = useRef<TextInput>(null)
  const [query, setQuery] = useState("")
  const [recent, setRecent] = usePreference<ReadonlyArray<string>>("recent-searches", [])
  const debounced = useDebounced(query.trim(), 220)
  const native = profile?.nativeLanguage ?? "en"
  const target = profile?.targetLanguage ?? "ja"
  const search = useSearch(debounced, target)
  // Fetched up front, so a search Kotori has already answered shows the answer with its results.
  useAsks()
  const searching = query.trim().length > 0
  // True from the first keystroke until this text's results arrive, debounce included.
  // The pose stays neutral until that wait is long enough to be worth a change.
  const loading = searching && (debounced !== query.trim() || search.isFetching)
  const mascot = useReadingPhase(loading)

  const history = recent.slice(0, MAX_RECENT)
  const remember = (term: string) => setRecent([term, ...recent.filter((r) => r !== term)].slice(0, MAX_RECENT))
  const forget = (term: string) => setRecent(recent.filter((r) => r !== term))

  const open = (entry: EntrySummary) => {
    remember(debounced)
    router.push({ pathname: "/entry/[id]", params: { id: String(entry.id) } })
  }

  const results = search.data
  // Results for the text being searched: while the next search loads, the last one's results
  // stay on screen, but what Kotori says about them doesn't.
  const current = results !== undefined && !search.isPlaceholderData ? results : null
  const pill = {
    backgroundColor: "rgba(255, 255, 255, 0.66)",
    borderWidth: 1,
    borderColor: theme.color.ring,
    borderRadius: theme.radius.pill,
    height: 40,
    flexDirection: "row" as const,
    alignItems: "center" as const
  }

  return (
    <Screen>
      <View
        style={{
          paddingBottom: 22,
          backgroundColor: theme.color.primaryTint,
          overflow: "hidden",
          ...(desktop
            ? {
                marginTop: theme.space.md,
                borderRadius: theme.radius.xl
              }
            : {
                marginHorizontal: -theme.space.lg,
                marginTop: -(insets.top + theme.space.sm),
                paddingTop: insets.top + theme.space.md,
                borderBottomLeftRadius: 40,
                borderBottomRightRadius: 40
              })
        }}
      >
        <Snow />
        <View
          style={{
            height: 46,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: 22,
            paddingRight: 16
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }} accessibilityRole="header">
            <Text variant="title" size={25} style={{ letterSpacing: -1.1, lineHeight: 30 }}>
              kotori
            </Text>
            <Text mincho size={14} color="textMuted" style={{ lineHeight: 18 }}>
              言鳥
            </Text>
          </View>
          <PressableScale
            haptic
            onPress={() => router.push("/settings")}
            accessibilityRole="button"
            accessibilityLabel={`${t.dictionary.language}: ${LANGUAGE_NAMES[native].long} → ${LANGUAGE_NAMES[target].long}`}
            style={[pill, { gap: 5, paddingHorizontal: 14 }]}
          >
            <Text variant="caption" size={13} weight="semibold">
              {LANGUAGE_NAMES[native].short}
            </Text>
            <Icon name="arrow_right_alt" size={17} color={theme.color.text} />
            <Text variant="caption" size={13} weight="semibold">
              {LANGUAGE_NAMES[target].long}
            </Text>
          </PressableScale>
        </View>

        <View style={{ paddingHorizontal: 22, paddingTop: 16, gap: 10 }}>
          <Text jp={target === "ja"} variant="caption" size={14} color="textMuted">
            {greeting(target, profile?.displayName ?? null)}
          </Text>
          <Text variant="display" accessibilityRole="header" style={{ maxWidth: 260 }}>
            {t.dictionary.title}
          </Text>
        </View>

        <View style={{ marginTop: 24, marginHorizontal: theme.space.lg }}>
          <SearchField ref={input} value={query} onChangeText={setQuery} placeholder={t.dictionary.placeholder} />
          <View pointerEvents="none" style={{ position: "absolute", right: 62, top: -58 }}>
            <Mascot size={70} mood={mascot} />
          </View>
        </View>

        {searching || history.length === 0 ? null : (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 22,
                paddingTop: 16
              }}
            >
              <Text variant="caption" color="textMuted">
                {t.dictionary.recent}
              </Text>
              <PressableScale onPress={() => setRecent([])} accessibilityRole="button" hitSlop={12}>
                <Text variant="caption" size={13} color="textMuted">
                  {t.dictionary.clearRecent}
                </Text>
              </PressableScale>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
              {history.map((term) => (
                <Animated.View
                  key={term}
                  entering={FadeIn.duration(180)}
                  layout={LinearTransition.duration(180)}
                  style={[pill, { paddingLeft: 12, paddingRight: 4, maxWidth: "100%" }]}
                >
                  <PressableScale
                    onPress={() => setQuery(term)}
                    accessibilityRole="button"
                    accessibilityLabel={term}
                    style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1, height: "100%" }}
                  >
                    <View style={{ opacity: 0.85 }}>
                      <Icon name="search" size={18} color={theme.color.text} />
                    </View>
                    <Text variant="caption" size={14} numberOfLines={1} style={{ flexShrink: 1, maxWidth: 180 }}>
                      {term}
                    </Text>
                  </PressableScale>
                  <PressableScale
                    onPress={() => forget(term)}
                    accessibilityRole="button"
                    accessibilityLabel={t.dictionary.removeRecent(term)}
                    hitSlop={6}
                    style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="close" size={16} color={theme.color.textMuted} />
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          </>
        )}
      </View>

      {searching ? (
        <View style={{ gap: theme.space.md }}>
          {results?.mode === "romaji" && results.reading ? (
            <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 6 }}>
              {t.dictionary.romajiNotice(results.reading)}
            </Text>
          ) : null}
          {search.isError ? <ErrorState error={search.error} onRetry={() => search.refetch()} /> : null}
          {current !== null && current.match !== "exact" ? (
            // Keyed by the question, so each query gets its own Kotori; an ask in flight lives on in the cache.
            <AskKotori
              key={`${target}:${normalizeAsk(debounced, target)}`}
              query={debounced}
              language={target}
              match={current.match}
              onOpen={open}
              onAnswered={() => remember(debounced)}
            />
          ) : null}
          {current !== null && current.match === "weak" && current.entries.length > 0 ? (
            // Only lookalikes: said plainly, so a learner doesn't take "bus" for "bussin".
            <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 6 }}>
              {t.dictionary.similarResults}
            </Text>
          ) : null}
          {results && results.entries.length > 0 ? (
            <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
              {results.entries.map((entry, index) => (
                <Animated.View
                  key={entry.id}
                  entering={FadeIn.delay(Math.min(index, 8) * 25).duration(200)}
                  layout={LinearTransition.duration(180)}
                >
                  <ResultRow entry={entry} first={index === 0} onPress={() => open(entry)} />
                </Animated.View>
              ))}
            </Card>
          ) : null}
        </View>
      ) : (
        <ReviewTeaser />
      )}
    </Screen>
  )
}
