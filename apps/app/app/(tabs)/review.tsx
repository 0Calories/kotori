import Ionicons from "@expo/vector-icons/Ionicons"
import { formatDelay } from "@kotori/srs"
import { useRouter } from "expo-router"
import { RefreshControl, View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { useNotes, useQueue, useStats } from "../../src/api/queries.ts"
import { Button } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { useTone } from "../../src/components/Chip.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { ErrorState } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const Count = ({
  label,
  value,
  tone
}: {
  readonly label: string
  readonly value: number
  readonly tone: "sky" | "plum" | "matcha"
}) => {
  const { fg } = useTone(tone)
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text variant="title" style={{ color: fg }}>
        {value}
      </Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  )
}

const Stat = ({
  icon,
  label,
  value
}: {
  readonly icon: keyof typeof Ionicons.glyphMap
  readonly label: string
  readonly value: string
}) => {
  const theme = useTheme()
  return (
    <Card style={{ flexBasis: "47%", flexGrow: 1, gap: 6 }}>
      <Ionicons name={icon} size={18} color={theme.color.primary} />
      <Text variant="title">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </Card>
  )
}

/** Cards due on each of the next seven days. One series, so one hue; today is emphasised. */
const Forecast = ({ days }: { readonly days: ReadonlyArray<number> }) => {
  const theme = useTheme()
  const { t, profile } = useSession()
  const max = Math.max(...days, 1)
  const locale = profile?.nativeLanguage === "ja" ? "ja-JP" : "en-US"
  const label = (offset: number) =>
    offset === 0
      ? t.review.today
      : new Date(Date.now() + offset * 86_400_000).toLocaleDateString(locale, { weekday: "short" })
  return (
    <Card
      accessible
      accessibilityLabel={`${t.review.forecast}: ${days.map((n, i) => `${label(i)} ${n}`).join(", ")}`}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 150, paddingTop: theme.space.lg }}
    >
      {days.map((count, offset) => (
        <View
          key={offset}
          style={{ flex: 1, alignItems: "center", gap: 6, justifyContent: "flex-end", height: "100%" }}
        >
          <Text variant="caption" color={count > 0 ? "textMuted" : "textFaint"}>
            {count}
          </Text>
          <View
            style={{
              width: "70%",
              maxWidth: 28,
              height: Math.max((count / max) * 72, 3),
              borderRadius: 6,
              backgroundColor: theme.color.primary,
              opacity: offset === 0 ? 1 : 0.45
            }}
          />
          <Text variant="caption" color={offset === 0 ? "text" : "textFaint"} style={{ fontSize: 11 }}>
            {label(offset)}
          </Text>
        </View>
      ))}
    </Card>
  )
}

export default function ReviewScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { t } = useSession()
  const queue = useQueue()
  const stats = useStats()
  const notes = useNotes()

  const counts = queue.data?.counts
  const due = counts ? counts.new + counts.learning + counts.review : 0
  const nextDue = queue.data?.nextDue ?? null

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={queue.isRefetching}
          onRefresh={() => {
            queue.refetch()
            stats.refetch()
          }}
        />
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Mascot size={56} mood={due > 0 ? "curious" : "sleepy"} />
        <View style={{ flex: 1 }}>
          <Text variant="title">{t.review.title}</Text>
          <Text variant="small" color="textMuted">
            {t.review.subtitle}
          </Text>
        </View>
      </View>

      {queue.isError ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} /> : null}

      {counts ? (
        <Animated.View entering={FadeInDown.duration(350)}>
          <Card style={{ gap: theme.space.lg }}>
            {due > 0 ? (
              <>
                <Text variant="label" color="textMuted">
                  {t.review.due.toUpperCase()}
                </Text>
                <View style={{ flexDirection: "row" }}>
                  <Count label={t.review.new} value={counts.new} tone="sky" />
                  <Count label={t.review.learning} value={counts.learning} tone="plum" />
                  <Count label={t.review.toReview} value={counts.review} tone="matcha" />
                </View>
                <Button
                  label={t.review.start}
                  icon="play"
                  size="lg"
                  full
                  onPress={() => router.push("/review/session")}
                />
              </>
            ) : (
              <View style={{ alignItems: "center", gap: 8, paddingVertical: theme.space.md }}>
                <Mascot size={96} mood="sleepy" />
                <Text variant="heading">{t.review.allDone}</Text>
                <Text color="textMuted" align="center">
                  {nextDue !== null
                    ? t.review.nextIn(formatDelay(Math.max(nextDue - Date.now(), 0)))
                    : t.review.allDoneHint}
                </Text>
              </View>
            )}
          </Card>
        </Animated.View>
      ) : null}

      {stats.data ? (
        <Section title={t.review.stats}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.space.md }}>
            <Stat icon="flame" label={t.review.streak} value={String(stats.data.streak)} />
            <Stat icon="checkmark-done" label={t.review.reviewedToday} value={String(stats.data.reviewedToday)} />
            <Stat
              icon="pulse"
              label={t.review.retention}
              value={stats.data.retention === null ? "—" : `${Math.round(stats.data.retention * 100)}%`}
            />
            <Stat
              icon="leaf"
              label={`${t.review.mature} / ${t.review.cards}`}
              value={`${stats.data.mature} / ${stats.data.cards}`}
            />
          </View>
        </Section>
      ) : null}

      {stats.data && stats.data.forecast.some((n) => n > 0) ? (
        <Section title={t.review.forecast}>
          <Forecast days={stats.data.forecast} />
        </Section>
      ) : null}

      <PressableScale onPress={() => router.push("/saved")} scaleTo={0.98}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name="bookmarks" size={20} color={theme.color.primary} />
          <Text variant="strong" style={{ flex: 1 }}>
            {t.review.saved}
          </Text>
          <Text color="textMuted">{notes.data?.length ?? 0}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.color.textFaint} />
        </Card>
      </PressableScale>
    </Screen>
  )
}
