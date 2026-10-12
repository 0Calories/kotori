import type { HowToSayResult, Register } from "@kotori/domain"
import { useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeInDown } from "react-native-reanimated"
import { useHowToSay } from "../../src/api/queries.ts"
import { Button } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Input } from "../../src/components/Input.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PhraseCard } from "../../src/components/PhraseCard.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { Segmented } from "../../src/components/Segmented.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { Text } from "../../src/components/Text.tsx"
import { useSession } from "../../src/session/SessionProvider.tsx"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

type Tone = "any" | Register

const Result = ({ result }: { readonly result: HowToSayResult }) => {
  const theme = useTheme()
  const router = useRouter()
  const { t } = useSession()
  return (
    <View style={{ gap: theme.space.lg }}>
      <Animated.View entering={FadeInDown.duration(400)}>
        <Card tone="sky" style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <Mascot size={48} mood="happy" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="label" color="sky">{t.say.understood.toUpperCase()}</Text>
            <Text>{result.intent}</Text>
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100).duration(400)}>
        <Section title={t.say.phrases}>
          {result.phrases.map((phrase, index) => (
            <PhraseCard
              key={index}
              text={phrase.text}
              furigana={phrase.furigana}
              register={phrase.register}
              meaning={phrase.whenToUse ? `${phrase.nuance} (${phrase.whenToUse})` : phrase.nuance}
              source="how-to-say"
              highlight={index === 0}
              lines={[
                { label: t.say.literal, text: phrase.literal },
                { text: phrase.nuance },
                { label: t.say.whenToUse, text: phrase.whenToUse }
              ]}
            />
          ))}
        </Section>
      </Animated.View>

      {result.keyWords.length > 0
        ? (
          <Animated.View entering={FadeInDown.delay(180).duration(400)}>
            <Section title={t.say.keyWords}>
              <Card style={{ gap: theme.space.md }}>
                {result.keyWords.map((word, index) => (
                  <PressableScale
                    key={index}
                    disabled={word.entryId === null}
                    onPress={() => word.entryId !== null && router.push({ pathname: "/entry/[id]", params: { id: String(word.entryId) } })}
                    style={{ flexDirection: "row", gap: 12, alignItems: "baseline" }}
                  >
                    <View style={{ minWidth: 84 }}>
                      <Text jp variant="strong" size={18} color={word.entryId !== null ? "primary" : "text"}>{word.word}</Text>
                      {word.reading !== word.word ? <Text jp variant="caption" color="textMuted">{word.reading}</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="small">{word.meaning}</Text>
                      {word.note ? <Text variant="caption" color="textMuted">{word.note}</Text> : null}
                    </View>
                  </PressableScale>
                ))}
              </Card>
            </Section>
          </Animated.View>
        )
        : null}

      {result.pitfalls.length > 0
        ? (
          <Animated.View entering={FadeInDown.delay(240).duration(400)}>
            <Section title={t.say.pitfalls}>
              {result.pitfalls.map((pitfall, index) => (
                <Card key={index} tone="plum" style={{ gap: 6 }}>
                  <Text jp variant="strong" color="plum" style={{ textDecorationLine: "line-through" }}>{pitfall.text}</Text>
                  <Text variant="small">{pitfall.why}</Text>
                </Card>
              ))}
            </Section>
          </Animated.View>
        )
        : null}

      {result.culturalNote
        ? (
          <Section title={t.say.culture}>
            <Card tone="yuzu"><Text variant="small">{result.culturalNote}</Text></Card>
          </Section>
        )
        : null}
    </View>
  )
}

export default function SayScreen() {
  const theme = useTheme()
  const { t, profile } = useSession()
  const ask = useHowToSay()
  const [text, setText] = useState("")
  const [context, setContext] = useState("")
  const [tone, setTone] = useState<Tone>("any")
  const native = profile?.nativeLanguage === "ja"

  const submit = () => {
    if (text.trim().length === 0) return
    ask.mutate({ text: text.trim(), register: tone, ...(context.trim() ? { context: context.trim() } : {}) })
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Mascot size={56} mood={ask.isPending ? "thinking" : "happy"} />
        <Text variant="title" style={{ flex: 1 }}>{t.say.title}</Text>
      </View>
      <Text color="textMuted">{t.say.subtitle}</Text>

      <Card style={{ gap: theme.space.md }}>
        <Input value={text} onChangeText={setText} placeholder={t.say.placeholder} multiline large jp={native} maxLength={400} accessibilityLabel={t.say.title} />
        <Input label={t.say.context} value={context} onChangeText={setContext} placeholder={t.say.contextPlaceholder} jp={native} maxLength={400} />
        <View style={{ gap: 6 }}>
          <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 4 }}>{t.say.register}</Text>
          <Segmented<Tone>
            value={tone}
            onChange={setTone}
            options={(["any", "casual", "neutral", "polite", "formal"] as const).map((value) => ({ value, label: t.say.registers[value] }))}
          />
        </View>
        <Button label={ask.isPending ? t.say.thinking : t.say.submit} icon="chatbubble-ellipses" size="lg" full loading={ask.isPending} disabled={text.trim().length === 0} onPress={submit} />
      </Card>

      {ask.isPending ? <MascotMessage mood="thinking" body={t.say.thinking} size={90} /> : null}
      {ask.isError ? <ErrorState error={ask.error} onRetry={submit} /> : null}
      {ask.data && !ask.isPending ? <Result result={ask.data} /> : null}
    </Screen>
  )
}
