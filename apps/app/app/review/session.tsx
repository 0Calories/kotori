import type { Language, Rating, ReviewItem } from "@kotori/contracts"
import { formatDelay } from "@kotori/srs"
import { useQueryClient } from "@tanstack/react-query"
import * as Haptics from "expo-haptics"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { Platform, View } from "react-native"
import Animated, { FadeIn, FadeInDown, FadeInUp, useAnimatedStyle, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { keys, useAnswer, useDueNotes } from "../../src/api/queries.ts"
import { AudioButton } from "../../src/components/AudioButton.tsx"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip, type Tone, useTone } from "../../src/components/Chip.tsx"
import { Furigana } from "../../src/components/Furigana.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { Notice } from "../../src/components/Notice.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { spokenGloss } from "../../src/lib/english.ts"
import {
  initialReviewSession,
  reduceReviewSession,
  reviewKeyAction,
  reviewView,
  unansweredItems,
  waitRefetchDelay
} from "../../src/lib/reviewSession.ts"
import { useReadingPhase } from "../../src/lib/readingPhase.ts"
import { registerTone } from "../../src/lib/tones.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const RATINGS: ReadonlyArray<{ readonly rating: Rating; readonly tone: Tone; readonly key: string }> = [
  { rating: "again", tone: "accent", key: "1" },
  { rating: "hard", tone: "neutral", key: "2" },
  { rating: "good", tone: "primary", key: "3" },
  { rating: "easy", tone: "neutral", key: "4" }
]

/** The two faces of a note: what's shown first, and what answers it. */
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
  const content = item.note.content

  if (content.kind === "word") {
    // The headword is in the language being learned. Notes saved before the English dictionary
    // are all Japanese words, which English learners saved for their English glosses.
    const language = content.language ?? "ja"
    const learning = language === target
    const headword = (
      <View style={{ alignItems: "center", gap: 4 }}>
        {revealed || !learning ? (
          <Text jp={language === "ja"} color="textMuted" size={18}>
            {content.reading.length > 0 && content.reading !== content.headword ? content.reading : " "}
          </Text>
        ) : null}
        <Headword language={language} size={language === "ja" ? 52 : 44} style={{ lineHeight: 62 }} align="center">
          {content.headword}
        </Headword>
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
    // The side in the language being learned comes first.
    const front = learning ? headword : meaning
    const back = learning ? meaning : headword
    return (
      <View style={{ gap: theme.space.xl, alignItems: "center" }}>
        <Text variant="label" color="textFaint">
          {t.review.recallMeaning.toUpperCase()}
        </Text>
        {front}
        {revealed ? (
          <Animated.View
            entering={FadeInDown.duration(260)}
            style={{ gap: theme.space.lg, alignItems: "center", width: "100%" }}
          >
            <View style={{ height: 1, alignSelf: "stretch", backgroundColor: theme.color.border }} />
            {back}
            {/* Learners hear the side they're learning: the headword, or for an older note its English. */}
            {learning ? (
              content.audioUrl === null && language === "en" ? (
                <AudioButton speak={{ text: content.headword, language }} size={44} />
              ) : (
                <AudioButton url={content.audioUrl} size={44} />
              )
            ) : (
              <AudioButton speak={{ text: spokenGloss(content.meaning.split("; ")[0]!), language: target }} size={44} />
            )}
            {content.note ? (
              <Text variant="small" color="textMuted" align="center">
                {content.note}
              </Text>
            ) : null}
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
        {t.review.recallMeaning.toUpperCase()}
      </Text>
      {content.register ? (
        <Chip tone={registerTone[content.register]} label={t.check.register[content.register]} />
      ) : null}
      {phrase}
      {revealed ? (
        <Animated.View
          entering={FadeInDown.duration(260)}
          style={{ gap: theme.space.lg, alignItems: "center", width: "100%" }}
        >
          <View style={{ height: 1, alignSelf: "stretch", backgroundColor: theme.color.border }} />
          {meaning}
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
  const dueNotes = useDueNotes()
  const kotoriReading = useReadingPhase(!dueNotes.data && !dueNotes.isLoadingError) === "reading"
  const answer = useAnswer()
  const [state, dispatch] = useReducer(reduceReviewSession, initialReviewSession)
  const shownAt = useRef(Date.now())
  // Answers sent and not yet settled. Two taps in one frame both see the note as revealed, and the
  // reducer only drops the second locally, so this keeps it from reaching the server too.
  const sending = useRef(new Set<string>())
  const [now, setNow] = useState(Date.now())
  // When the server recorded each answer this session. A failed refetch keeps the old due notes,
  // so the ones answered since are left out until a fetch succeeds.
  const [savedAt, setSavedAt] = useState<ReadonlyMap<string, number>>(new Map())

  const dueItems = unansweredItems(dueNotes.data?.items ?? [], savedAt, dueNotes.dataUpdatedAt)
  const { current, revealed, leech, remaining } = reviewView(state, dueItems)
  // Record the opening note before paint. The reducer pins each note after that, so a
  // refetch that gathers a new head can't replace whichever one is already showing.
  if (state.pinned === null && current !== undefined) dispatch({ type: "pin", item: current })
  const { reviewed } = state
  const total = remaining + reviewed
  const nextDue = dueNotes.data?.nextDue?.getTime() ?? null

  useEffect(() => {
    shownAt.current = Date.now()
  }, [current?.note.id])

  // When only learning notes remain, wait for the next one to come due. Each completed fetch
  // (even one that returns the same due time) schedules the next, with a floor on the delay.
  const fetchedAt = Math.max(dueNotes.dataUpdatedAt, dueNotes.errorUpdatedAt)
  const refetchDue = dueNotes.refetch
  useEffect(() => {
    if (current !== undefined || nextDue === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const refetch = setTimeout(() => void refetchDue(), waitRefetchDelay(nextDue, Date.now()))
    return () => {
      clearInterval(timer)
      clearTimeout(refetch)
    }
  }, [current === undefined, nextDue, fetchedAt, refetchDue])

  // A failed-answer message stays a moment, then goes.
  useEffect(() => {
    if (state.notice === null) return
    const timer = setTimeout(() => dispatch({ type: "dismissNotice" }), 4000)
    return () => clearTimeout(timer)
  }, [state.notice])

  const close = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.stats })
    void queryClient.invalidateQueries({ queryKey: keys.due })
    router.canGoBack() ? router.back() : router.replace("/review")
  }, [queryClient, router])

  const reveal = useCallback(() => dispatch({ type: "reveal", noteId: current?.note.id ?? null }), [current?.note.id])

  const respond = useCallback(
    async (rating: Rating) => {
      if (current === undefined || !revealed) return
      const item = current
      const id = item.note.id
      if (sending.current.has(id)) return
      sending.current.add(id)
      if (Platform.OS !== "web")
        Haptics.impactAsync(
          rating === "again" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
        ).catch(() => {})
      dispatch({ type: "answer", item, rating, items: dueItems })
      let result
      try {
        result = await answer.mutateAsync({ id, rating, durationMs: Date.now() - shownAt.current })
      } catch {
        // Not recorded: put this note back. The advance above already pinned the next one.
        sending.current.delete(id)
        dispatch({ type: "answerFailed", item })
        return
      }
      sending.current.delete(id)
      setSavedAt((saved) => new Map(saved).set(id, Date.now()))
      // Recorded. refetch() resolves even when the fetch fails: the due notes keep their last data
      // and the query is marked as errored, so the pinned note stays and a notice offers a retry.
      await dueNotes.refetch()
      dispatch({ type: "answerSaved", noteId: id, leech: result.leech })
    },
    [current, revealed, answer, dueNotes, dueItems]
  )

  // Keyboard shortcuts on the web: space to reveal, 1-4 to answer, Escape to leave.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return
    const onKey = (event: KeyboardEvent) => {
      const action = reviewKeyAction(event, { hasNote: current !== undefined, revealed })
      if (event.key === " " || event.key === "Enter") event.preventDefault()
      if (action === null) return
      if (action.type === "close") close()
      else if (action.type === "reveal") reveal()
      else void respond(action.rating)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, revealed, respond, reveal, close])

  const progress = useAnimatedStyle(() => ({
    width: withTiming(`${total === 0 ? 0 : (reviewed / total) * 100}%`, { duration: 300 })
  }))

  const body = (() => {
    // Only a failed first load has nothing to show. After a failed refetch the pinned note and its
    // buttons keep working on the due notes as last fetched, with the notice above.
    if (dueNotes.isLoadingError) return <ErrorState error={dueNotes.error} onRetry={() => dueNotes.refetch()} />
    if (!dueNotes.data || kotoriReading) return kotoriReading ? <MascotMessage mood="reading" /> : null
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
        key={current.note.id}
        entering={FadeIn.duration(220)}
        style={{ flex: 1, justifyContent: "center" }}
      >
        <PressableScale onPress={reveal} disabled={revealed} scaleTo={0.99} accessibilityLabel={t.review.showAnswer}>
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
        {state.notice === "answerFailed" ? (
          <Animated.View entering={FadeInUp}>
            <Text variant="caption" color="accent" align="center" style={{ marginTop: 12 }}>
              {t.review.answerFailed}
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
          <Mascot size={36} mood={revealed ? "happy" : "neutral"} />
        </View>

        {dueNotes.isRefetchError ? (
          <Notice
            message={t.common.notRefreshed}
            action={{ label: t.common.retry, onPress: () => void dueNotes.refetch() }}
          />
        ) : null}

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
            <Button label={t.review.showAnswer} size="lg" full onPress={reveal} />
          )
        ) : null}
      </View>
    </View>
  )
}
