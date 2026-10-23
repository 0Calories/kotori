import type { Issue, NaturalnessResult } from "@kotori/domain"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { useNaturalness } from "../../src/api/queries.ts"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Furigana } from "../../src/components/Furigana.tsx"
import { Icon } from "../../src/components/Icon.tsx"
import { Input } from "../../src/components/Input.tsx"
import { Mascot, type Mood } from "../../src/components/Mascot.tsx"
import { NuanceScales } from "../../src/components/NuanceScales.tsx"
import { PhraseCard } from "../../src/components/PhraseCard.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { registerTone } from "../../src/lib/tones.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const MOOD: Record<NaturalnessResult["verdict"], Mood> = {
  natural: "celebrate",
  understandable: "happy",
  unnatural: "thinking",
  incorrect: "oops"
}

const FORMALITY = ["vulgar", "casual", "neutral", "polite", "formal"] as const

/** What the learner wrote, with each mistake underlined in rose. */
const Written = ({ text, issues }: { readonly text: string; readonly issues: ReadonlyArray<Issue> }) => {
  const theme = useTheme()
  const { profile } = useSession()
  if (profile?.targetLanguage !== "en") {
    return <Furigana text={text} size={20} marks={issues.map((issue) => ({ text: issue.excerpt, kind: "mistake" }))} />
  }
  // English wraps by word, so it's marked with a text underline instead of per-character units.
  const mistake = issues.map((issue) => issue.excerpt).find((excerpt) => excerpt.length > 0 && text.includes(excerpt))
  const at = mistake === undefined ? -1 : text.indexOf(mistake)
  return (
    <Text variant="heading" size={20} weight="medium" selectable>
      {at < 0 || mistake === undefined ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <Text
            variant="heading"
            size={20}
            weight="medium"
            style={{ textDecorationLine: "underline", textDecorationColor: theme.color.accentMark }}
          >
            {mistake}
          </Text>
          {text.slice(at + mistake.length)}
        </>
      )}
    </Text>
  )
}

const IssueCard = ({ issue, number }: { readonly issue: Issue; readonly number: number }) => {
  const theme = useTheme()
  const { t } = useSession()
  return (
    <Card style={{ flexDirection: "row", gap: 12 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: theme.color.primaryDark,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Text variant="caption" weight="bold" size={13} style={{ color: theme.color.onPrimaryDark, lineHeight: 16 }}>
          {number}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 10, paddingTop: 5 }}>
        <Text variant="label" color="textMuted">
          {t.check.issueKind[issue.kind].toUpperCase()}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text
            variant="strong"
            weight="medium"
            color="textFaint"
            style={{ textDecorationLine: "line-through", textDecorationColor: theme.color.accent }}
          >
            {issue.excerpt}
          </Text>
          <Icon name="arrow_forward" size={18} color={theme.color.textMuted} />
          <Text variant="strong" weight="bold">
            {issue.fix}
          </Text>
        </View>
        <Text color="textMuted">{issue.explanation}</Text>
      </View>
    </Card>
  )
}

const Result = ({
  text,
  result,
  onEdit
}: {
  readonly text: string
  readonly result: NaturalnessResult
  readonly onEdit: () => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const natural = result.verdict === "natural"
  const [best, ...others] = result.rewrites
  const alternatives = natural ? result.rewrites : others

  return (
    <View style={{ gap: theme.space.md }}>
      <View style={{ paddingHorizontal: 6, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: -8 }}>
          <Text variant="label" color="textMuted">
            {t.check.youWrote.toUpperCase()}
          </Text>
          <View style={{ marginRight: -12 }}>
            <IconButton icon="edit" label={t.check.again} onPress={onEdit} />
          </View>
        </View>
        <Written text={text} issues={result.issues} />
      </View>

      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 6, paddingVertical: 4 }}
      >
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 20,
            backgroundColor: theme.color.primaryTint,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Mascot size={48} mood={MOOD[result.verdict]} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="heading" accessibilityRole="header">
            {t.check.verdict[result.verdict]}
          </Text>
          <Text variant="small" color="textMuted">
            {result.summary} {t.check.byAi}
          </Text>
        </View>
      </Animated.View>

      {best && !natural ? (
        <Animated.View entering={FadeInDown.delay(80).duration(400)}>
          <PhraseCard
            label={t.check.natural}
            text={best.text}
            furigana={best.furigana}
            register={best.register}
            meaning={best.translation}
            source="naturalness"
            highlight
            lines={[{ text: best.translation }, { text: best.note }]}
          />
        </Animated.View>
      ) : null}

      {result.issues.map((issue, index) => (
        <Animated.View key={issue.excerpt} entering={FadeInDown.delay(140 + index * 60).duration(400)}>
          <IssueCard issue={issue} number={index + 1} />
        </Animated.View>
      ))}

      <Animated.View entering={FadeInDown.delay(200).duration(400)}>
        <Card style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text variant="label" color="textMuted" style={{ flexShrink: 1 }}>
              {t.check.meaning.toUpperCase()}
            </Text>
            <Chip tone={registerTone[result.register]} label={t.check.register[result.register]} />
          </View>
          <Text variant="strong">{result.meaning}</Text>
          {result.formality ? (
            <View style={{ paddingTop: theme.space.md, borderTopWidth: 1, borderTopColor: theme.color.divider }}>
              <NuanceScales
                rows={[
                  {
                    left: t.nuance.poles.casual,
                    right: t.nuance.poles.formal,
                    position: result.formality.position,
                    value: t.nuance.scale[FORMALITY[Math.round(result.formality.position * 4)] ?? "neutral"],
                    faded: result.formality.confidence < 0.55
                  }
                ]}
              />
            </View>
          ) : null}
        </Card>
      </Animated.View>

      {alternatives.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(260).duration(400)}>
          <Section title={natural ? t.check.alternatives : t.check.rewrites}>
            {alternatives.map((rewrite) => (
              <PhraseCard
                key={rewrite.text}
                text={rewrite.text}
                furigana={rewrite.furigana}
                register={rewrite.register}
                meaning={rewrite.translation}
                source="naturalness"
                lines={[{ text: rewrite.translation }, { text: rewrite.note }]}
              />
            ))}
          </Section>
        </Animated.View>
      ) : null}
    </View>
  )
}

export default function CheckScreen() {
  const theme = useTheme()
  const { t, profile } = useSession()
  const check = useNaturalness()
  const [text, setText] = useState("")
  const [context, setContext] = useState("")
  const [intent, setIntent] = useState("")
  const [showMore, setShowMore] = useState(false)
  const jp = profile?.targetLanguage === "ja"

  const submit = () => {
    if (text.trim().length === 0) return
    check.mutate({
      text: text.trim(),
      ...(context.trim() ? { context: context.trim() } : {}),
      ...(intent.trim() ? { intent: intent.trim() } : {})
    })
  }

  if (check.data && check.variables && !check.isPending) {
    return (
      <Screen>
        <Result text={check.variables.text} result={check.data} onEdit={() => check.reset()} />
      </Screen>
    )
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Mascot size={56} mood={check.isPending ? "thinking" : "curious"} />
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          {t.check.title}
        </Text>
      </View>
      <Text color="textMuted" style={{ paddingHorizontal: 2 }}>
        {t.check.subtitle}
      </Text>

      <Card style={{ gap: theme.space.md }}>
        <Input
          value={text}
          onChangeText={setText}
          placeholder={t.check.placeholder}
          multiline
          large
          jp={jp}
          maxLength={400}
          accessibilityLabel={t.check.title}
        />
        <PressableScale
          onPress={() => setShowMore(!showMore)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showMore }}
          style={{ flexDirection: "row", gap: 4, alignItems: "center", alignSelf: "flex-start", minHeight: 32 }}
        >
          <Icon name={showMore ? "remove" : "add"} size={18} color={theme.color.primaryDark} />
          <Text variant="caption" size={13} weight="semibold" color="primaryDark">
            {t.check.context} · {t.check.intent}
          </Text>
        </PressableScale>
        {showMore ? (
          <Animated.View entering={FadeInDown.duration(220)} style={{ gap: theme.space.md }}>
            <Input
              label={t.check.context}
              value={context}
              onChangeText={setContext}
              placeholder={t.check.contextPlaceholder}
              maxLength={400}
            />
            <Input
              label={t.check.intent}
              value={intent}
              onChangeText={setIntent}
              placeholder={t.check.intentPlaceholder}
              maxLength={400}
            />
          </Animated.View>
        ) : null}
        <Button
          label={check.isPending ? t.check.checking : t.check.submit}
          icon="spellcheck"
          size="lg"
          full
          loading={check.isPending}
          disabled={text.trim().length === 0}
          onPress={submit}
        />
      </Card>

      {check.isPending ? <MascotMessage mood="thinking" body={t.check.checking} size={90} /> : null}
      {check.isError ? <ErrorState error={check.error} onRetry={submit} /> : null}
    </Screen>
  )
}
