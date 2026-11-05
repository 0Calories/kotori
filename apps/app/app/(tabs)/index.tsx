import type { EntrySummary, Language, Proposal } from "@kotori/contracts"
import { inOtherLanguage, normalizeAsk } from "@kotori/language"
import { useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Platform, TextInput, useWindowDimensions, View } from "react-native"
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ApiError } from "../../src/api/client.ts"
import { useAsk, useAsks, useQueue, useSearch, useStats } from "../../src/api/queries.ts"
import { Button } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { posLabel, type Strings, strings } from "../../src/i18n/strings.ts"
import { useSearchMascotPhase } from "../../src/lib/searchMascot.ts"
import { currencyTone, formalityTone } from "../../src/lib/tones.ts"
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
  const currency = entry.currency && entry.currency !== "current" ? entry.currency : null
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
        {entry.inflection.length > 0 ||
        entry.common ||
        pos ||
        currency ||
        (entry.formality && entry.formality !== "neutral") ? (
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
            {currency ? <Chip tone={currencyTone[currency]} label={t.nuance.currency[currency]} /> : null}
          </View>
        ) : null}
      </View>
      <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
    </PressableScale>
  )
}

/** Why an ask failed, in the learner's language: a refusal by its code, else the server's message. */
const askError = (t: Strings, error: Error) =>
  error instanceof ApiError && error.refusal !== null
    ? t.dictionary.askRefused[error.refusal]
    : error instanceof ApiError && error.tag === "Offline"
      ? t.common.offline
      : error.message || t.common.somethingWrong

/** Offers to ask Kotori, and says so while it thinks; errors fall back to a plain retry. */
const AskButton = ({ ask, query }: { readonly ask: ReturnType<typeof useAsk>; readonly query: string }) => {
  const { t } = useSession()
  if (ask.isPending) {
    return (
      <Text variant="caption" color="textMuted">
        {t.dictionary.askThinking}
      </Text>
    )
  }
  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      {ask.isError ? (
        <Text variant="caption" color="textMuted" align="center">
          {askError(t, ask.error)}
        </Text>
      ) : (
        <Text variant="caption" color="textMuted" align="center">
          {t.dictionary.askExplain}
        </Text>
      )}
      <Button
        label={ask.isError ? t.dictionary.askAgain : t.dictionary.askKotori}
        variant="soft"
        icon="auto_awesome"
        onPress={() => ask.mutate(query)}
      />
    </View>
  )
}

/** Kotori's answer to an ask: a draft entry marked unverified, the entry it linked, or why not. */
const AskAnswer = ({
  proposal,
  onOpen
}: {
  readonly proposal: Proposal
  readonly onOpen: (entry: EntrySummary) => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  if (proposal.status === "linked" || proposal.status === "approved") {
    if (proposal.linked === null) return null
    return (
      <View style={{ gap: 6 }}>
        <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 6 }}>
          {t.dictionary.askLinked}
        </Text>
        <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
          <ResultRow entry={proposal.linked} first onPress={() => onOpen(proposal.linked!)} />
        </Card>
      </View>
    )
  }
  if (proposal.draft === null) {
    // Turned away: Claude's reason for a lookup, or where a sentence, name or other language belongs.
    const body =
      proposal.route !== null && proposal.route !== "lookup"
        ? t.dictionary.askRoute[proposal.route]
        : (proposal.reason ?? t.dictionary.askNotReal)
    return <MascotMessage mood="oops" body={body} size={90} />
  }
  const draft = proposal.draft
  const joiner = proposal.language === "ja" ? "; " : "、"
  return (
    <Card style={{ gap: 10 }}>
      <Chip tone="accent" icon="auto_awesome" label={t.dictionary.askDraft} />
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <Headword language={proposal.language} size={proposal.language === "ja" ? 24 : 21}>
          {draft.headword}
        </Headword>
        {draft.reading.length > 0 ? (
          <Text jp={proposal.language === "ja"} variant="small" color="textMuted">
            {draft.reading}
          </Text>
        ) : null}
        {draft.currency !== "current" ? (
          <Chip tone={currencyTone[draft.currency]} label={t.nuance.currency[draft.currency]} />
        ) : null}
      </View>
      {draft.senses.map((sense, index) => (
        <View key={index} style={{ gap: 4 }}>
          <Text>{sense.glosses.join(joiner)}</Text>
          {sense.note ? (
            <Text variant="small" color="textMuted">
              {sense.note}
            </Text>
          ) : null}
        </View>
      ))}
    </Card>
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
        <Mascot size={56} mood={due > 0 ? "neutral" : "sleepy"} />
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
  const { width } = useWindowDimensions()
  const desktop = width > theme.maxWidth
  const input = useRef<TextInput>(null)
  const [query, setQuery] = useState("")
  const [recent, setRecent] = usePreference<ReadonlyArray<string>>("recent-searches", [])
  const debounced = useDebounced(query.trim(), 220)
  const native = profile?.nativeLanguage ?? "en"
  const target = profile?.targetLanguage ?? "ja"
  const search = useSearch(debounced, target)
  const ask = useAsk()
  const asks = useAsks()
  // A past answer for this query shows again without asking, found by the key the server keeps it under.
  const askKey = normalizeAsk(debounced, target)
  // Ask Kotori looks into the language being learned, so it isn't offered for the learner's own.
  const askable = !inOtherLanguage(askKey, target)
  const answer = useMemo(
    () =>
      ask.data && ask.variables === debounced ? ask.data : (asks.data?.find((past) => past.query === askKey) ?? null),
    [ask.data, ask.variables, asks.data, askKey, debounced]
  )
  useEffect(() => ask.reset(), [debounced])
  const searching = query.trim().length > 0
  // True from the first keystroke until this text's results arrive, debounce included.
  // The pose stays neutral until that wait is long enough to be worth a change.
  const loading = searching && (debounced !== query.trim() || search.isFetching)
  const mascot = useSearchMascotPhase(loading)

  const history = recent.slice(0, MAX_RECENT)
  const remember = (term: string) => setRecent([term, ...recent.filter((r) => r !== term)].slice(0, MAX_RECENT))
  const forget = (term: string) => setRecent(recent.filter((r) => r !== term))

  const open = (entry: EntrySummary) => {
    remember(debounced)
    router.push({ pathname: "/entry/[id]", params: { id: String(entry.id) } })
  }

  const results = search.data
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
          {results && results.entries.length === 0 && !search.isFetching ? (
            <MascotMessage mood="oops" facing="front" body={t.dictionary.noResults} size={90}>
              {answer === null && askable ? <AskButton ask={ask} query={debounced} /> : null}
            </MascotMessage>
          ) : null}
          {results && results.match === "weak" && !search.isFetching ? (
            // Only lookalikes: said plainly, so a learner doesn't take "bus" for "bussin".
            <MascotMessage mood="neutral" facing="front" body={t.dictionary.noExactMatch(results.query)} size={90}>
              {answer === null && askable ? <AskButton ask={ask} query={debounced} /> : null}
            </MascotMessage>
          ) : null}
          {results && results.match !== "exact" && !search.isFetching && answer !== null ? (
            <AskAnswer proposal={answer} onOpen={open} />
          ) : null}
          {results && results.match === "weak" && !search.isFetching && results.entries.length > 0 ? (
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
