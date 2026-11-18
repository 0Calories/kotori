import type { EntrySummary, Language, SearchMatch } from "@kotori/contracts"
import { inOtherLanguage, normalizeAsk } from "@kotori/language"
import * as Haptics from "expo-haptics"
import { LinearGradient } from "expo-linear-gradient"
import { type ReactNode, useEffect, useEffectEvent, useState } from "react"
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOutUp,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming
} from "react-native-reanimated"
import { ApiError } from "../api/client.ts"
import { useAsk, useAsks, useLatestAsk } from "../api/queries.ts"
import type { Strings } from "../i18n/strings.ts"
import {
  ASK_STAGE_STARTS,
  type AskAnswer,
  type AskFailure,
  askMood,
  askProgress,
  askRevealAt,
  askStage,
  askView,
  type AskView,
  formatWait,
  retryable
} from "../lib/ask.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { easeInOut, easeOut } from "../theme/easing.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Button } from "./Button.tsx"
import { Card } from "./Card.tsx"
import { DraftCard } from "./DraftCard.tsx"
import { Mascot } from "./Mascot.tsx"
import { ResultRow } from "./ResultRow.tsx"
import { Text } from "./Text.tsx"

/**
 * The time as of the first render, moved on to `at` (or just past it) once that comes. The
 * panel only needs to know which side of a moment it's on, so it doesn't tick in between.
 */
const useClockPast = (at: number | null) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (at === null || now >= at) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, at - Date.now()) + 10)
    return () => clearTimeout(timer)
  }, [at, now])
  return now
}

/** The status line showing now for an ask sent at `since`, or the first when nothing is asked. */
const stageAt = (since: number | null) => (since === null ? 0 : askStage(Date.now() - since))

/**
 * Which thinking line shows for an ask sent at `since`, moving on to each as its time comes, or
 * the first when nothing is being asked. A new ask starts over.
 */
const useAskStage = (since: number | null) => {
  const [shown, setShown] = useState(() => ({ since, stage: stageAt(since) }))
  // A new ask (or none) starts over from its own first line.
  if (shown.since !== since) setShown({ since, stage: stageAt(since) })
  useEffect(() => {
    if (since === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const after = (from: number) => {
      const next = from + 1
      const start = ASK_STAGE_STARTS[next]
      if (start === undefined) return
      timer = setTimeout(
        () => {
          setShown({ since, stage: next })
          after(next)
        },
        Math.max(0, start - (Date.now() - since))
      )
    }
    after(stageAt(since))
    return () => clearTimeout(timer)
  }, [since])
  return shown.since === since ? shown.stage : stageAt(since)
}

/** The ms left until `until`, ticking as the second shown by `formatWait` changes. */
const useCountdown = (until: number) => {
  const [now, setNow] = useState(Date.now)
  const left = Math.max(0, until - now)
  useEffect(() => {
    if (left === 0) return
    const timer = setTimeout(() => setNow(Date.now()), left % 1000 || 1000)
    return () => clearTimeout(timer)
  }, [left])
  return left
}

/** Shakes Kotori's head once whenever `trigger` takes a new value: its "oh no" at a failed ask. */
const Wobble = ({ trigger, children }: { readonly trigger: number | null; readonly children: ReactNode }) => {
  const reduceMotion = useReducedMotion()
  const shake = useSharedValue(0)
  useEffect(() => {
    if (trigger === null || reduceMotion) return
    const swing = (to: number, duration: number) => withTiming(to, { duration, easing: easeInOut })
    shake.set(withSequence(swing(-1, 80), swing(1, 120), swing(-0.6, 110), swing(0.3, 100), swing(0, 90)))
  }, [reduceMotion, shake, trigger])
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.get() * 6 }, { rotate: `${shake.get() * 7}deg` }]
  }))
  return <Animated.View style={style}>{children}</Animated.View>
}

const BAR_WIDTH = 176
const GLINT_WIDTH = 44

/**
 * A soft bar that fills while Kotori thinks (see `askProgress`), a glint running along what's
 * filled so it never looks stuck. It reports progress rather than decorating, so it still fills
 * with reduced motion; only the glint stops.
 */
const ThinkingBar = ({ since }: { readonly since: number }) => {
  const theme = useTheme()
  const reduceMotion = useReducedMotion()
  const elapsed = useSharedValue(0)
  const glint = useSharedValue(0)
  useEffect(() => {
    const from = Date.now() - since
    elapsed.set(from)
    elapsed.set(
      withTiming(from + 120_000, { duration: 120_000, easing: Easing.linear, reduceMotion: ReduceMotion.Never })
    )
    return () => cancelAnimation(elapsed)
  }, [elapsed, since])
  useEffect(() => {
    if (reduceMotion) return
    glint.set(0)
    glint.set(withRepeat(withDelay(500, withTiming(1, { duration: 1100, easing: easeInOut })), -1, false))
    return () => cancelAnimation(glint)
  }, [glint, reduceMotion])
  const fill = useAnimatedStyle(() => ({ width: `${askProgress(elapsed.get()) * 100}%` as const }))
  const shine = useAnimatedStyle(() => ({
    transform: [{ translateX: -GLINT_WIDTH + glint.get() * (BAR_WIDTH + GLINT_WIDTH) }]
  }))
  return (
    <View
      style={{
        width: BAR_WIDTH,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.color.primaryTint,
        overflow: "hidden"
      }}
    >
      <Animated.View
        style={[{ height: "100%", borderRadius: 4, backgroundColor: theme.color.primary, overflow: "hidden" }, fill]}
      >
        {reduceMotion ? null : (
          <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: GLINT_WIDTH }, shine]}>
            <LinearGradient
              colors={["rgba(255, 255, 255, 0)", "rgba(255, 255, 255, 0.75)", "rgba(255, 255, 255, 0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  )
}

/**
 * What Kotori is up to while it thinks: one line at a time, each rising in as the last rises
 * away, over the filling bar.
 */
const ThinkingStatus = ({ since, reached }: { readonly since: number; readonly reached: number }) => {
  const { t } = useSession()
  const lines = t.dictionary.askThinking
  const stage = Math.min(reached, lines.length - 1)
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={lines[stage]}
      accessibilityState={{ busy: true }}
      style={{ alignSelf: "stretch", alignItems: "center", gap: 12 }}
    >
      <View style={{ alignSelf: "stretch", height: 44, overflow: "hidden" }}>
        <Animated.View
          key={stage}
          entering={stage === 0 ? FadeIn.duration(200) : FadeInDown.duration(380).easing(easeOut)}
          exiting={FadeOutUp.duration(260).easing(easeOut)}
          style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }]}
        >
          <Text color="textMuted" align="center">
            {lines[stage]}
          </Text>
        </Animated.View>
      </View>
      <ThinkingBar since={since} />
    </View>
  )
}

const Message = ({
  title,
  body,
  detail
}: {
  readonly title?: string
  readonly body: string
  /** Someone's own words under the message, such as a reviewer's reason. */
  readonly detail?: string | null
}) => (
  <View style={{ alignItems: "center", gap: 6 }}>
    {title ? (
      <Text variant="heading" align="center">
        {title}
      </Text>
    ) : null}
    <Text color="textMuted" align="center" style={{ maxWidth: 360 }}>
      {body}
    </Text>
    {detail ? (
      <Text variant="small" color="textFaint" align="center" style={{ maxWidth: 360 }}>
        {detail}
      </Text>
    ) : null}
  </View>
)

/** Kotori's words on its answer, which shows below: a fresh draft gets a headline. */
const answerWords = (
  t: Strings,
  answer: AskAnswer,
  live: boolean
): { readonly title?: string; readonly body: string; readonly detail?: string | null } => {
  switch (answer.kind) {
    case "draft":
      return live
        ? { title: t.dictionary.askDrafted, body: t.dictionary.askDraftedBody }
        : { body: t.dictionary.askDrafted }
    case "linked":
      return { body: answer.approved ? t.dictionary.askApproved : t.dictionary.askLinked }
    case "rejected":
      // A query that isn't a lookup is pointed elsewhere; one that is gets Claude's reason, or ours.
      return {
        body: answer.route === null ? (answer.reason ?? t.dictionary.askNotReal) : t.dictionary.askRoute[answer.route]
      }
    case "discarded":
      return { body: t.dictionary.askDiscarded, detail: answer.reason }
  }
}

const failureText = (t: Strings, failure: AskFailure) => {
  switch (failure.kind) {
    case "refused":
      return t.dictionary.askRefused[failure.refusal]
    case "busy":
      return t.dictionary.askBusy
    case "resting":
      return t.dictionary.askResting
    case "napping":
      return t.dictionary.askNapping
    case "unavailable":
      return t.dictionary.askUnavailable
    case "offline":
      return t.common.offline
    case "unexpected":
      return t.common.somethingWrong
  }
}

/** Asks again; after a rate limit, it counts down the wait the server gave and only then lets you. */
const AskAgain = ({ until, onPress }: { readonly until: number; readonly onPress: () => void }) => {
  const { t } = useSession()
  const left = useCountdown(until)
  return (
    <Button
      label={left > 0 ? t.dictionary.askAgainIn(formatWait(left)) : t.dictionary.askAgain}
      variant="soft"
      icon="refresh"
      disabled={left > 0}
      onPress={onPress}
    />
  )
}

/** The entry Kotori matched the query to, lit up for a moment when it has just been found. */
const LinkedEntry = ({
  entry,
  live,
  onOpen
}: {
  readonly entry: EntrySummary
  readonly live: boolean
  readonly onOpen: (entry: EntrySummary) => void
}) => {
  const theme = useTheme()
  const glow = useSharedValue(live ? 1 : 0)
  useEffect(() => {
    if (live) glow.set(withDelay(600, withTiming(0, { duration: 1400, easing: easeOut })))
  }, [glow, live])
  const lit = useAnimatedStyle(() => ({ opacity: glow.get() }))
  return (
    <Animated.View entering={live ? FadeInDown.duration(380).delay(120).easing(easeOut) : FadeIn.duration(250)}>
      <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.color.primaryTint, borderRadius: theme.radius.lg - 1 },
            lit
          ]}
        />
        <ResultRow entry={entry} first onPress={() => onOpen(entry)} />
      </Card>
    </Animated.View>
  )
}

const AnswerCard = ({
  answer,
  language,
  live,
  onOpen
}: {
  readonly answer: AskAnswer
  readonly language: Language
  readonly live: boolean
  readonly onOpen: (entry: EntrySummary) => void
}) => {
  switch (answer.kind) {
    case "draft":
      return <DraftCard draft={answer.draft} language={language} live={live} />
    case "linked":
      return <LinkedEntry entry={answer.entry} live={live} onOpen={onOpen} />
    case "rejected":
    case "discarded":
      return null
  }
}

/** Room inside `Resizing`'s clip for the shadows of the cards it holds. */
const SHADOW_ROOM = 14

/**
 * Grows and shrinks with its content instead of jumping, so the results below glide as Kotori's
 * answer comes and goes: it measures what it holds and animates its own height, clipping the
 * content meanwhile. A layout transition on the results wouldn't do: on the web, one only plays
 * when its own view re-renders, and the results don't when Kotori's state changes. With reduced
 * motion it simply takes the new height.
 */
const Resizing = ({ children }: { readonly children: ReactNode }) => {
  const reduceMotion = useReducedMotion()
  // -1 until measured: the first height is taken as it is.
  const height = useSharedValue(-1)
  const style = useAnimatedStyle(() => (height.get() < 0 ? {} : { height: height.get() }))
  return (
    <Animated.View
      style={[{ overflow: "hidden", marginHorizontal: -SHADOW_ROOM, paddingHorizontal: SHADOW_ROOM }, style]}
    >
      <View
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height
          height.set(height.get() < 0 || reduceMotion ? next : withTiming(next, { duration: 320, easing: easeInOut }))
        }}
      >
        {children}
      </View>
    </Animated.View>
  )
}

/** How the phone answers an outcome the learner watched arrive. */
const feedbackFor = (view: AskView) => {
  if (view.phase === "answered") return Haptics.NotificationFeedbackType.Success
  if (view.phase !== "failed") return null
  // Running out of asks is a pause, not a mistake.
  return view.failure.kind === "busy" || view.failure.kind === "resting" || view.failure.kind === "napping"
    ? Haptics.NotificationFeedbackType.Warning
    : Haptics.NotificationFeedbackType.Error
}

/**
 * Ask Kotori, under a search with no exact match. Kotori offers to look into the query, thinks
 * out loud while Claude works (a line at a time, over a filling bar), and then celebrates a
 * fresh draft, points to the entry the learner missed, says why the query isn't a word, or
 * shakes its head at a failure, with a way to ask again whenever that could help. The ask's
 * state lives in the query cache under the query, so typing away and back finds it as it was.
 */
export const AskKotori = ({
  query,
  language,
  match,
  onOpen,
  onAnswered
}: {
  /** The search as typed. */
  readonly query: string
  /** The language being learned: the dictionary searched, and the language of the word asked about. */
  readonly language: Language
  readonly match: Exclude<SearchMatch, "exact">
  readonly onOpen: (entry: EntrySummary) => void
  /** A fresh answer names a word, so the screen can keep the search among the recent ones. */
  readonly onAnswered: () => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const key = normalizeAsk(query, language)
  const ask = useAsk(language, key)
  const attempt = useLatestAsk(language, key)
  const asks = useAsks()
  // Whether this panel saw the latest ask in flight: only then does its outcome arrive with a flourish.
  const [watched, setWatched] = useState(attempt?.status === "pending")
  if (attempt?.status === "pending" && !watched) setWatched(true)
  const now = useClockPast(askRevealAt(attempt, watched))

  const view = askView({
    attempt,
    proposal: asks.data?.find((past) => past.query === key) ?? null,
    // A past answer may be on its way; until the learner's asks are in, don't offer to ask again.
    offerable: !asks.isPending && !inOtherLanguage(key, language),
    watched,
    now,
    toError: (error) => (error instanceof ApiError ? error : null)
  })
  // The status line and Kotori's pose move on together: reading through the first lines, then thinking.
  const stage = useAskStage(view.phase === "thinking" ? view.since : null)
  const { mood, facing } = askMood(view, match, stage)
  const live = (view.phase === "answered" || view.phase === "failed") && view.live
  // Each attempt's outcome, once: the haptic lands as the outcome shows, and a word found is kept.
  const outcome = live ? `${view.phase}:${attempt?.submittedAt ?? 0}` : null
  const announce = useEffectEvent(() => {
    if (view.phase === "answered" && (view.answer.kind === "draft" || view.answer.kind === "linked")) onAnswered()
    const feedback = feedbackFor(view)
    if (feedback !== null && Platform.OS !== "web") Haptics.notificationAsync(feedback).catch(() => {})
    // Android and the web announce the change from the live region; VoiceOver needs telling.
    if (Platform.OS === "ios") {
      const words =
        view.phase === "answered"
          ? answerWords(t, view.answer, view.live)
          : view.phase === "failed"
            ? { body: failureText(t, view.failure) }
            : null
      if (words !== null)
        AccessibilityInfo.announceForAccessibility([words.title, words.body].filter(Boolean).join(" "))
    }
  })
  useEffect(() => {
    if (outcome !== null) announce()
  }, [outcome])
  const shaken =
    view.phase === "failed" && view.live && view.failure.kind !== "resting" && view.failure.kind !== "napping"
      ? (attempt?.submittedAt ?? null)
      : null

  const prompt = match === "none" ? t.dictionary.noResults : t.dictionary.noExactMatch(query)
  const send = () => ask.mutate(query)

  const content = (() => {
    switch (view.phase) {
      case "quiet":
        return <Message body={prompt} />
      case "offer":
        return (
          <>
            <Message body={prompt} />
            <Text variant="caption" color="textMuted" align="center" style={{ maxWidth: 360 }}>
              {t.dictionary.askExplain}
            </Text>
            <Button
              label={t.dictionary.askKotori}
              icon="auto_awesome"
              variant={match === "none" ? "primary" : "soft"}
              onPress={send}
            />
          </>
        )
      case "thinking":
        return <ThinkingStatus since={view.since} reached={stage} />
      case "answered":
        return <Message {...answerWords(t, view.answer, view.live)} />
      case "failed":
        return (
          <>
            <Message body={failureText(t, view.failure)} />
            {retryable(view.failure) ? (
              <AskAgain
                until={view.failure.kind === "busy" || view.failure.kind === "resting" ? view.failure.retryAt : 0}
                onPress={send}
              />
            ) : null}
          </>
        )
    }
  })()

  return (
    <Animated.View entering={FadeIn.duration(250)}>
      <View style={{ alignItems: "center", paddingTop: theme.space.xl }}>
        <Wobble trigger={shaken}>
          <Mascot size={90} mood={mood} facing={facing} />
        </Wobble>
      </View>
      <Resizing>
        <View style={{ gap: theme.space.lg, paddingTop: theme.space.md, paddingBottom: theme.space.lg }}>
          {/* The live region stays put while what it holds is swapped, so the change is announced. */}
          <View accessibilityLiveRegion="polite">
            <Animated.View
              key={view.phase === "thinking" ? `thinking:${view.since}` : `${view.phase}:${attempt?.submittedAt ?? 0}`}
              entering={FadeIn.duration(240).easing(easeOut)}
              style={{ alignItems: "center", gap: 10 }}
            >
              {content}
            </Animated.View>
          </View>
          {view.phase === "answered" ? (
            <AnswerCard answer={view.answer} language={language} live={view.live} onOpen={onOpen} />
          ) : null}
        </View>
      </Resizing>
    </Animated.View>
  )
}
