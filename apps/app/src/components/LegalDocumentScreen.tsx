import type { Language } from "@kotori/contracts"
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { strings } from "../i18n/strings.ts"
import { legalDocument, type LegalKind, legalLanguageFromParam } from "../lib/legal.ts"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Card } from "./Card.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Header, Screen } from "./Screen.tsx"
import { Segmented } from "./Segmented.tsx"
import { Text } from "./Text.tsx"

const LANGUAGE_OPTIONS: ReadonlyArray<{ readonly value: Language; readonly label: string }> = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" }
]

/** Public `/privacy` and `/terms` page, reachable signed in or signed out on web and native. */
export const LegalDocumentScreen = ({ kind }: { readonly kind: LegalKind }) => {
  const theme = useTheme()
  const router = useRouter()
  const { status, t } = useSession()
  const { lang } = useLocalSearchParams<{ lang?: string | string[] }>()
  const defaultLanguage: Language = t === strings.ja ? "ja" : "en"
  const [language, setLanguage] = useState<Language>(() => legalLanguageFromParam(lang, defaultLanguage))
  const doc = legalDocument(kind, language)

  const fallbackHref =
    status === "ready" ? "/" : status === "onboarding" ? "/onboarding" : status === "pending" ? "/pending" : "/welcome"
  const back = () => (router.canGoBack() ? router.back() : router.replace(fallbackHref))

  return (
    <Screen bottomInset={40} header={<Header onBack={back} title={doc.title} />}>
      <Stack.Screen options={{ title: `${doc.title} · Kotori` }} />
      <Animated.View entering={FadeIn.duration(220)} style={{ gap: theme.space.lg }}>
        <View style={{ gap: 8, paddingHorizontal: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <Text variant="caption" color="textFaint">
              {doc.updated}
            </Text>
            <Segmented<Language> options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} />
          </View>
          <Text variant="title" accessibilityRole="header">
            {doc.title}
          </Text>
          <Text variant="small" color="textMuted">
            {doc.intro}
          </Text>
        </View>
        {doc.sections.map((section) => (
          <Card key={section.id} style={{ gap: 8 }}>
            <Text variant="strong" accessibilityRole="header">
              {section.title}
            </Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} variant="small" color="textMuted" selectable>
                {paragraph}
              </Text>
            ))}
          </Card>
        ))}
        <View style={{ alignItems: "center", paddingTop: 4 }}>
          <Link href={{ pathname: doc.companionHref, params: { lang: language } }} asChild>
            <PressableScale accessibilityRole="link" hitSlop={10}>
              <Text variant="caption" color="textMuted" style={{ textDecorationLine: "underline" }}>
                {doc.companionLabel}
              </Text>
            </PressableScale>
          </Link>
        </View>
      </Animated.View>
    </Screen>
  )
}
