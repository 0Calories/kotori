import type { EntrySummary, Language } from "@kotori/domain"
import { useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Platform, TextInput, View } from "react-native"
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useQueue, useSearch, useStats } from "../../src/api/queries.ts"
import { Button } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { posLabel, strings } from "../../src/i18n/strings.ts"
import { formalityTone } from "../../src/lib/tones.ts"
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

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/

const LANGUAGE_NAMES: Record<Language, { readonly short: string; readonly long: string }> = {
  en: { short: "EN", long: "English" },
  ja: { short: "日本語", long: "日本語" }
}

const ResultRow = ({
  entry,
  first,
  onPress
}: {
  readonly entry: EntrySummary
  readonly first: boolean
  readonly onPress: () => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const pos = posLabel(t, entry.partOfSpeech)
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="link"
      accessibilityLabel={`${entry.headword}, ${entry.meanings.join(", ")}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.divider
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <Headword language={entry.language} size={entry.language === "ja" ? 24 : 21} style={{ lineHeight: 30 }}>
            {entry.headword}
          </Headword>
          {entry.reading.length > 0 && entry.reading !== entry.headword ? (
            <Text jp={entry.language === "ja"} variant="small" color="textMuted">
              {entry.reading}
            </Text>
          ) : null}
        </View>
        <Text color="textMuted" numberOfLines={2}>
          {entry.meanings.join(entry.language === "ja" ? "; " : "、")}
        </Text>
        {entry.inflection.length > 0 || entry.common || pos || (entry.formality && entry.formality !== "neutral") ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {entry.inflection.length > 0 ? (
              <Chip
                tone="primary"
                icon="call_split"
                label={t.dictionary.inflected(entry.inflection.map((i) => t.inflection[i] ?? i).join(" · "))}
              />
            ) : null}
            {entry.common ? <Chip label={t.dictionary.common} /> : null}
            {pos ? <Chip label={pos} /> : null}
            {entry.formality && entry.formality !== "neutral" ? (
              <Chip tone={formalityTone[entry.formality]} label={t.nuance.scale[entry.formality]} />
            ) : null}
          </View>
        ) : null}
      </View>
      <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
    </PressableScale>
  )
}

const ReviewTeaser = () => {
  const { t } = useSession()
  const router = useRouter()
  const queue = useQueue()
  const stats = useStats()
  const due = queue.data ? queue.data.counts.new + queue.data.counts.learning + queue.data.counts.review : 0
  if (!queue.data) return null
  return (
    <Animated.View entering={FadeInDown.duration(400)}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Mascot size={56} mood={due > 0 ? "curious" : "sleepy"} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="strong">{due > 0 ? t.dictionary.reviewCard(due) : t.dictionary.reviewCardNone}</Text>
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
  const input = useRef<TextInput>(null)
  const [query, setQuery] = useState("")
  const [recent, setRecent] = usePreference<ReadonlyArray<string>>("recent-searches", [])
  const debounced = useDebounced(query.trim(), 220)
  const native = profile?.nativeLanguage ?? "en"
  const target = profile?.targetLanguage ?? "ja"
  const search = useSearch(debounced, target)
  const searching = query.trim().length > 0
  // Kotori thinks until the results for what's typed arrive, including the debounce before the request.
  const loading = searching && (debounced !== query.trim() || search.isFetching)

  const remember = (term: string) => setRecent([term, ...recent.filter((r) => r !== term)].slice(0, 8))

  const open = (entry: EntrySummary) => {
    remember(debounced)
    router.push({ pathname: "/entry/[id]", params: { id: String(entry.id) } })
  }

  const results = search.data
  const tips = useMemo(() => t.dictionary.tips, [t])
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
          marginHorizontal: -theme.space.lg,
          marginTop: -(insets.top + theme.space.sm),
          paddingTop: insets.top,
          paddingBottom: 22,
          backgroundColor: theme.color.primaryTint,
          borderBottomLeftRadius: 40,
          borderBottomRightRadius: 40,
          overflow: "hidden"
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
          <View
            style={[
              {
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                height: 60,
                borderRadius: 30,
                backgroundColor: theme.color.surface,
                paddingLeft: 18,
                paddingRight: 8,
                borderWidth: 1.5,
                borderColor: searching ? theme.color.primaryDark : "transparent"
              },
              theme.shadow(2)
            ]}
          >
            <Icon name="search" size={24} color={theme.color.textMuted} />
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
                {
                  flex: 1,
                  // 16px on the web keeps iOS Safari from zooming into the field; the mock's 15.5 elsewhere.
                  fontSize: Platform.OS === "web" ? 16 : 15.5,
                  color: theme.color.text,
                  fontFamily: theme.font.regular,
                  height: "100%"
                },
                { outlineStyle: "none" } as object
              ]}
            />
            {searching ? (
              <PressableScale
                onPress={() => setQuery("")}
                accessibilityRole="button"
                accessibilityLabel={t.common.close}
                hitSlop={8}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="cancel" size={22} filled color={theme.color.textFaint} />
              </PressableScale>
            ) : null}
          </View>
          <View pointerEvents="none" style={{ position: "absolute", right: 62, top: -58 }}>
            <Mascot size={70} mood={loading ? "thinking" : "curious"} />
          </View>
        </View>

        {searching ? null : (
          <>
            <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 22, paddingTop: 16 }}>
              {t.dictionary.tipsTitle}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
              {tips.map((tip) => (
                <PressableScale
                  key={tip}
                  onPress={() => setQuery(tip)}
                  accessibilityRole="button"
                  style={[pill, { gap: 7, paddingLeft: 12, paddingRight: 15 }]}
                >
                  <View style={{ opacity: 0.85 }}>
                    <Icon name="menu_book" size={18} color={theme.color.text} />
                  </View>
                  <Text variant="caption" size={14}>
                    {tip}
                  </Text>
                </PressableScale>
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
          {results && results.entries.length === 0 && !search.isFetching ? (
            <MascotMessage mood="oops" body={t.dictionary.noResults} size={90} />
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
        <>
          <ReviewTeaser />
          {recent.length > 0 ? (
            <Section
              title={t.dictionary.recent}
              action={
                <PressableScale onPress={() => setRecent([])} accessibilityRole="button" hitSlop={12}>
                  <Text variant="caption" size={13} color="textMuted">
                    {t.dictionary.clearRecent}
                  </Text>
                </PressableScale>
              }
            >
              <Card list padded={false} style={{ paddingHorizontal: theme.space.lg }}>
                {recent.map((term, index) => (
                  <PressableScale
                    key={term}
                    onPress={() => setQuery(term)}
                    accessibilityRole="button"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      height: 56,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.color.divider
                    }}
                  >
                    <Text
                      mincho={JAPANESE.test(term)}
                      variant="strong"
                      size={JAPANESE.test(term) ? 22 : 17}
                      style={{ flex: 1, lineHeight: 28 }}
                      numberOfLines={1}
                    >
                      {term}
                    </Text>
                    <Icon name="chevron_right" size={20} color={theme.color.textMuted} />
                  </PressableScale>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  )
}
