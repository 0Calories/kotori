import type { Language, Rating, ReviewItem } from "@kotori/domain"
import { formatDelay } from "@kotori/srs"
import { useQueryClient } from "@tanstack/react-query"
import * as Haptics from "expo-haptics"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { Platform, View } from "react-native"
import Animated, { FadeIn, FadeInDown, FadeInUp, useAnimatedStyle, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { keys, useAnswer, useQueue } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip, type Tone, useTone } from "../../src/components/Chip.tsx"
import { Furigana } from "../../src/components/Furigana.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { spokenGloss } from "../../src/lib/english.ts"
import { registerTone } from "../../src/lib/tones.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const RATINGS: ReadonlyArray<{ readonly rating: Rating; readonly tone: Tone; readonly key: string }> = [
  { rating: "again", tone: "accent", key: "1" },
  { rating: "hard", tone: "neutral", key: "2" },
  { rating: "good", tone: "primary", key: "3" },
  { rating: "easy", tone: "neutral", key: "4" }
]

/** The two faces of a card: what's shown first, and what answers it. */
const Faces = ({
  item,
  revealed,
  target
}: {
  readonly item: ReviewItem
  readonly revealed: boolean
  readonly target: Language
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const { card } = item
  const content = card.content
  const recognize = card.template === "recognize"

  if (content.kind === "word") {
    // Word notes come from the Japanese dictionary; which side is "target" depends on the learner.
    const japanese = (
      <View style={{ alignItems: "center", gap: 4 }}>
        {revealed || target === "en" ? (
          <Text jp color="textMuted" size={18}>
            {content.reading !== content.headword ? content.reading : " "}
          </Text>
        ) : null}
        <Text mincho size={52} style={{ lineHeight: 62 }} align="center">
          {content.headword}
        </Text>
      </View>
    )
    const meaning = (
      <View style={{ alignItems: "center", gap: 8 }}>
        <Text variant="title" align="center">
          {content.meaning}
        </Text>
        {content.hint ? <Chip tone="neutral" label={content.hint} /> : null}
      </View>
    )
    const japaneseFirst = target === "ja" ? recognize : !recognize
    const front = japaneseFirst ? japanese : meaning
    const back = japaneseFirst ? meaning : japanese
    return (
      <View style={{ gap: theme.space.xl, alignItems: "center" }}>
        <Text variant="label" color="textFaint">
          {(japaneseFirst === (target === "ja") ? t.review.recallMeaning : t.review.recallWord).toUpperCase()}
        </Text>
        {front}
        {revealed ? (
          <Animated.View
            entering={FadeInDown.duration(260)}
            style={{ gap: theme.space.lg, alignItems: "center", width: "100%" }}
          >
            <View style={{ height: 1, alignSelf: "stretch", backgroundColor: theme.color.border }} />
            {back}
            {/* Learners hear the side they're learning: the headword, or for Japanese speakers its English. */}
            {target === "en" ? (
              <AudioButton speak={{ text: spokenGloss(content.meaning.split("; ")[0]!), language: "en" }} size={44} />
            ) : (
              <AudioButton url={content.audioUrl} size={44} />
            )}
            {content.example ? (
              <View
                style={{
                  gap: 6,
                  alignSelf: "stretch",
                  backgroundColor: theme.color.surfaceMuted,
                  borderRadius: theme.radius.md,
                  padding: theme.space.md
                }}
              >
                <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                  <View style={{ flex: 1 }}>
                    {target === "en" ? (
                      <Text variant="strong">{content.example.en}</Text>
                    ) : (
                      <Furigana text={content.example.ja} furigana={content.example.furigana} size={17} />
                    )}
                  </View>
                  <AudioButton
                    url={target === "en" ? (content.example.translationAudioUrl ?? null) : content.example.audioUrl}
                    size={32}
                  />
                </View>
                <Text jp={target === "en"} variant="small" color="textMuted">
                  {target === "en" ? content.example.ja : content.example.en}
                </Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    )
  }

  const phrase =
    target === "ja" ? (
      <Furigana text={content.text} furigana={content.furigana} size={26} center />
    ) : (
      <Text variant="title" align="center">
        {content.text}
      </Text>
    )
  const meaning = (
    <Text variant="heading" align="center">
      {content.meaning}
    </Text>
  )
  return (
    <View style={{ gap: theme.space.xl, alignItems: "center" }}>
      <Text variant="label" color="textFaint">
        {(recognize ? t.review.recallMeaning : t.review.recallPhrase).toUpperCase()}
      </Text>
      {content.register ? (
        <Chip tone={registerTone[content.register]} label={t.check.register[content.register]} />
      ) : null}
      {recognize ? phrase : meaning}
      {revealed ? (
        <Animated.View
          entering={FadeInDown.duration(260)}
          style={{ gap: theme.space.lg, alignItems: "center", width: "100%" }}
        >
          <View style={{ height: 1, alignSelf: "stretch", backgroundColor: theme.color.border }} />
          {recognize ? meaning : phrase}
          <AudioButton speak={{ text: content.text, language: target }} size={44} />
          {content.note ? (
            <Text variant="small" color="textMuted" align="center">
              {content.note}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  )
}

const AnswerButton = ({
  label,
  interval,
  tone,
  onPress,
  hotkey
}: {
  readonly label: string
  readonly interval: string
  readonly tone: Tone
  readonly onPress: () => void
  readonly hotkey: string
}) => {
  const theme = useTheme()
  const { fg, bg, ring } = useTone(tone)
  const { radius } = theme
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.94}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${interval}`}
      style={{
        flex: 1,
        alignItems: "center",
        paddingVertical: 12,
        borderRadius: radius.md,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: ring,
        gap: 2
      }}
    >
      <Text variant="strong" style={{ color: fg }}>
        {label}
      </Text>
      <Text variant="caption" style={{ color: fg, opacity: 0.8 }}>
        {interval}
      </Text>
      {Platform.OS === "web" ? (
        <Text variant="caption" style={{ color: fg, opacity: 0.45, fontSize: 10, lineHeight: 12 }}>
          {hotkey}
        </Text>
      ) : null}
    </PressableScale>
  )
}

export default function ReviewSession() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const { t, profile } = useSession()
  const target: Language = profile?.targetLanguage ?? "ja"
  const queue = useQueue()
  const answer = useAnswer()
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())
  const [revealed, setRevealed] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [leech, setLeech] = useState(false)
  const shownAt = useRef(Date.now())
  const [now, setNow] = useState(Date.now())

  // Cards answered but not yet reflected in a refreshed queue are hidden locally, so the next card appears instantly.
  const items = (queue.data?.items ?? []).filter((item) => !answered.has(item.card.id))
  const current = items[0]
  const remaining = items.length
  const total = remaining + reviewed
  const nextDue = queue.data?.nextDue ?? null

  useEffect(() => {
    shownAt.current = Date.now()
  }, [current?.card.id])

  // When only learning cards remain, wait for the next one to come due.
  useEffect(() => {
    if (current !== undefined || nextDue === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const refetch = setTimeout(() => void queue.refetch(), Math.max(nextDue - Date.now(), 0) + 500)
    return () => {
      clearInterval(timer)
      clearTimeout(refetch)
    }
  }, [current, nextDue])

  const close = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.stats })
    void queryClient.invalidateQueries({ queryKey: keys.queue })
    router.canGoBack() ? router.back() : router.replace("/review")
  }, [queryClient, router])

  const respond = useCallback(
    async (rating: Rating) => {
      if (current === undefined || !revealed) return
      const id = current.card.id
      if (Platform.OS !== "web")
        Haptics.impactAsync(
          rating === "again" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
        ).catch(() => {})
      setAnswered((set) => new Set(set).add(id))
      setRevealed(false)
      setReviewed((n) => n + 1)
      try {
        const result = await answer.mutateAsync({ id, rating, durationMs: Date.now() - shownAt.current })
        setLeech(result.leech)
        await queue.refetch()
      } catch {
        // Not recorded: the card comes back below to be answered again.
        setReviewed((n) => n - 1)
      } finally {
        setAnswered((set) => {
          const next = new Set(set)
          next.delete(id)
          return next
        })
      }
    },
    [current, revealed, answer, queue]
  )

  // Keyboard shortcuts on the web: space to reveal, 1-4 to answer, Escape to leave.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return close()
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault()
        if (!revealed) setRevealed(true)
        else void respond("good")
        return
      }
      const choice = RATINGS.find((r) => r.key === event.key)
      if (choice && revealed) void respond(choice.rating)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [revealed, respond, close])

  const progress = useAnimatedStyle(() => ({
    width: withTiming(`${total === 0 ? 0 : (reviewed / total) * 100}%`, { duration: 300 })
  }))

  const body = (() => {
    if (queue.isError) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
    if (!queue.data) return <MascotMessage mood="thinking" />
    if (current === undefined) {
      if (nextDue !== null && reviewed > 0) {
        return <MascotMessage mood="sleepy" title={t.review.nextIn(formatDelay(Math.max(nextDue - now, 0)))} />
      }
      return (
        <MascotMessage
          mood="celebrate"
          size={150}
          title={reviewed > 0 ? t.review.sessionDone : t.review.allDone}
          body={reviewed > 0 ? t.review.sessionDoneHint(reviewed) : t.review.allDoneHint}
        >
          <Button label={t.review.finish} icon="check" onPress={close} />
        </MascotMessage>
      )
    }
    return (
      <Animated.View
        key={current.card.id}
        entering={FadeIn.duration(220)}
        style={{ flex: 1, justifyContent: "center" }}
      >
        <PressableScale
          onPress={() => setRevealed(true)}
          disabled={revealed}
          scaleTo={0.99}
          accessibilityLabel={t.review.showAnswer}
        >
          <Card
            style={{
              paddingVertical: theme.space.xxl,
              paddingHorizontal: theme.space.xl,
              minHeight: 320,
              justifyContent: "center"
            }}
          >
            <Faces item={current} revealed={revealed} target={target} />
          </Card>
        </PressableScale>
        {leech ? (
          <Animated.View entering={FadeInUp}>
            <Text variant="caption" color="accent" align="center" style={{ marginTop: 12 }}>
              {t.review.leech}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
    )
  })()

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: theme.maxWidth,
          alignSelf: "center",
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 20,
          gap: 16
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <IconButton icon="close" label={t.common.close} onPress={close} />
          <View
            style={{
              flex: 1,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.color.surfaceMuted,
              overflow: "hidden"
            }}
          >
            <Animated.View
              style={[{ height: "100%", backgroundColor: theme.color.primary, borderRadius: 4 }, progress]}
            />
          </View>
          {current !== undefined ? (
            <Text variant="caption" color="textMuted">
              {remaining} {t.review.remaining}
            </Text>
          ) : null}
          <Mascot size={36} mood={revealed ? "happy" : "curious"} />
        </View>

        {body}

        {current !== undefined ? (
          revealed ? (
            <Animated.View entering={FadeInUp.duration(200)} style={{ flexDirection: "row", gap: 8 }}>
              {RATINGS.map(({ rating, tone, key }) => (
                <AnswerButton
                  key={rating}
                  label={t.review[rating]}
                  interval={current.labels[rating]}
                  tone={tone}
                  hotkey={key}
                  onPress={() => respond(rating)}
                />
              ))}
            </Animated.View>
          ) : (
            <Button label={t.review.showAnswer} size="lg" full onPress={() => setRevealed(true)} />
          )
        ) : null}
      </View>
    </View>
  )
}
