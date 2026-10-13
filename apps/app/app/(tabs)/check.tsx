import type { NaturalnessResult } from "@kotori/domain"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { useNaturalness } from "../../src/api/queries.ts"
import { Button } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Input } from "../../src/components/Input.tsx"
import { Mascot, type Mood } from "../../src/components/Mascot.tsx"
import { Meter } from "../../src/components/Meter.tsx"
import { PhraseCard } from "../../src/components/PhraseCard.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { ScoreRing } from "../../src/components/ScoreRing.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { registerTone, verdictTone } from "../../src/lib/tones.ts"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const MOOD: Record<NaturalnessResult["verdict"], Mood> = {
  natural: "celebrate",
  understandable: "happy",
  unnatural: "thinking",
  incorrect: "oops"
}

const Result = ({ result }: { readonly result: NaturalnessResult }) => {
  const theme = useTheme()
  const { t } = useSession()
  const tone = verdictTone[result.verdict]
  const ringColor = { matcha: theme.color.matcha, sky: theme.color.sky, yuzu: theme.color.yuzu, plum: theme.color.plum }[tone as "matcha"]
  const FORMALITY = ["vulgar", "casual", "neutral", "polite", "formal"] as const

  return (
    <View style={{ gap: theme.space.lg }}>
      <Animated.View entering={FadeInDown.duration(400)}>
        <Card style={{ gap: theme.space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.lg }}>
            <ScoreRing score={result.score} color={ringColor ?? theme.color.primary} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="title" style={{ color: ringColor }}>{t.check.verdict[result.verdict]}</Text>
              <Chip tone={registerTone[result.register]} label={t.check.register[result.register]} />
            </View>
            <Mascot size={64} mood={MOOD[result.verdict]} />
          </View>
          <Text>{result.summary}</Text>
          {result.formality
            ? (
              <Meter
                title={t.check.sounds}
                labels={FORMALITY.map((level) => t.nuance.scale[level])}
                position={result.formality.position}
                value={t.nuance.scale[FORMALITY[Math.round(result.formality.position * 4)] ?? "neutral"]}
                faded={result.formality.confidence < 0.55}
              />
            )
            : null}
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100).duration(400)}>
        <Section title={t.check.meaning}>
          <Card tone="muted"><Text>{result.meaning}</Text></Card>
        </Section>
      </Animated.View>

      {result.issues.length > 0
        ? (
          <Animated.View entering={FadeInDown.delay(180).duration(400)}>
            <Section title={t.check.issues}>
              {result.issues.map((issue, index) => (
                <Card key={index} style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Chip tone="yuzu" label={t.check.issueKind[issue.kind]} />
                    <Text jp variant="strong" style={{ textDecorationLine: "underline", textDecorationColor: theme.color.yuzu }}>{issue.excerpt}</Text>
                  </View>
                  <Text variant="small">{issue.explanation}</Text>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    <Text variant="small" color="matcha">→</Text>
                    <Text jp variant="small" color="matcha" style={{ flex: 1 }}>{issue.fix}</Text>
                  </View>
                </Card>
              ))}
            </Section>
          </Animated.View>
        )
        : null}

      {result.rewrites.length > 0
        ? (
          <Animated.View entering={FadeInDown.delay(260).duration(400)}>
            <Section title={result.verdict === "natural" ? t.check.alternatives : t.check.rewrites}>
              {result.rewrites.map((rewrite, index) => (
                <PhraseCard
                  key={index}
                  text={rewrite.text}
                  furigana={rewrite.furigana}
                  register={rewrite.register}
                  meaning={rewrite.translation}
                  source="naturalness"
                  highlight={index === 0 && result.verdict !== "natural"}
                  lines={[{ text: rewrite.translation }, { text: rewrite.note }]}
                />
              ))}
            </Section>
          </Animated.View>
        )
        : null}
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

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Mascot size={56} mood={check.isPending ? "thinking" : "curious"} />
        <View style={{ flex: 1 }}>
          <Text variant="title">{t.check.title}</Text>
        </View>
      </View>
      <Text color="textMuted">{t.check.subtitle}</Text>

      <Card style={{ gap: theme.space.md }}>
        <Input value={text} onChangeText={setText} placeholder={t.check.placeholder} multiline large jp={jp} maxLength={400} accessibilityLabel={t.check.title} />
        <PressableScale onPress={() => setShowMore(!showMore)} style={{ flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", paddingVertical: 4 }}>
          <Text variant="caption" color="primary">{showMore ? "−" : "+"} {t.check.context} · {t.check.intent}</Text>
        </PressableScale>
        {showMore
          ? (
            <Animated.View entering={FadeInDown.duration(220)} style={{ gap: theme.space.md }}>
              <Input label={t.check.context} value={context} onChangeText={setContext} placeholder={t.check.contextPlaceholder} maxLength={400} />
              <Input label={t.check.intent} value={intent} onChangeText={setIntent} placeholder={t.check.intentPlaceholder} maxLength={400} />
            </Animated.View>
          )
          : null}
        <Button label={check.isPending ? t.check.checking : t.check.submit} icon="sparkles" size="lg" full loading={check.isPending} disabled={text.trim().length === 0} onPress={submit} />
      </Card>

      {check.isPending ? <MascotMessage mood="thinking" body={t.check.checking} size={90} /> : null}
      {check.isError ? <ErrorState error={check.error} onRetry={submit} /> : null}
      {check.data && !check.isPending ? <Result result={check.data} /> : null}
    </Screen>
  )
}
