/**
 * PROTOTYPE: the Perch entry page (`src/proto/EntryPerch.tsx`) on sample words, in either palette
 * and either interface language, with no session or API: `/proto/entry?word=kuu&theme=sora&ui=en`.
 * The controls sit under the page, since its sky runs up under the header; `1`–`5` switch the word.
 */
import type { Language, Sense } from "@kotori/contracts"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"
import { Card } from "../../src/components/Card.tsx"
import { Text } from "../../src/components/Text.tsx"
import { hasKotoriContent } from "../../src/lib/entry.ts"
import { PerchEntry } from "../../src/proto/EntryPerch.tsx"
import { SAMPLE_ENTRIES, type SampleWordKey } from "../../src/proto/entrySamples.ts"
import { PrototypeLanguageProvider, setDevLanguageOverride } from "../../src/session/SessionProvider.tsx"
import { setDevThemeOverride, useDevThemeOverride, useTheme, useThemeName } from "../../src/theme/ThemeProvider.tsx"
import { fade, type ThemeName } from "../../src/theme/tokens.ts"

const WORD_KEYS: ReadonlyArray<SampleWordKey> = ["kuu", "gokurousama", "manshon", "advice", "kangamiru"]

const first = (raw: string | readonly string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw)

const parseWord = (raw: string | readonly string[] | undefined): SampleWordKey => {
  const value = first(raw)
  return WORD_KEYS.find((key) => key === value) ?? "kuu"
}

const parseUiLanguage = (raw: string | readonly string[] | undefined): Language => (first(raw) === "ja" ? "ja" : "en")

const parsePalette = (raw: string | readonly string[] | undefined, fallback: ThemeName): ThemeName => {
  const value = first(raw)
  return value === "wakatake" || value === "sora" ? value : fallback
}

const ControlPill = ({
  label,
  selected,
  onPress
}: {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
}) => {
  const { color } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        backgroundColor: selected ? color.ink : color.surface,
        borderWidth: 1,
        borderColor: selected ? color.ink : fade(color.ink, 0.08)
      }}
    >
      <Text
        variant="caption"
        weight={selected ? "bold" : "medium"}
        style={{ color: selected ? color.onPrimaryDark : color.textMuted, fontSize: 12, lineHeight: 16 }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const PerchSurface = ({
  wordKey,
  onSelectWord,
  palette,
  onSelectPalette,
  uiLanguage,
  onSelectUiLanguage
}: {
  readonly wordKey: SampleWordKey
  readonly onSelectWord: (next: SampleWordKey) => void
  readonly palette: ThemeName
  readonly onSelectPalette: (next: ThemeName) => void
  readonly uiLanguage: Language
  readonly onSelectUiLanguage: (next: Language) => void
}) => {
  const router = useRouter()
  const [savedSenses, setSavedSenses] = useState<ReadonlySet<number>>(() => new Set([0]))
  const [askedKotori, setAskedKotori] = useState(false)
  const [writing, setWriting] = useState(false)
  const data = SAMPLE_ENTRIES[wordKey].entry
  const plain = !hasKotoriContent(data) && !writing

  const controls = (
    <Card tone="muted" style={{ gap: 10, padding: 14, marginTop: 8 }}>
      <Text variant="label" color="textMuted" style={{ textTransform: "uppercase" }}>
        PROTOTYPE · ENTRY PAGE (PERCH) · SAMPLE WORDS
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {WORD_KEYS.map((key, index) => (
          <ControlPill
            key={key}
            label={`${index + 1} · ${SAMPLE_ENTRIES[key].label}`}
            selected={wordKey === key}
            onPress={() => {
              setAskedKotori(false)
              onSelectWord(key)
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        <ControlPill label="Sora" selected={palette === "sora"} onPress={() => onSelectPalette("sora")} />
        <ControlPill label="Wakatake" selected={palette === "wakatake"} onPress={() => onSelectPalette("wakatake")} />
        <ControlPill
          label={uiLanguage === "en" ? "UI: EN" : "UI: 日本語"}
          selected={uiLanguage === "ja"}
          onPress={() => onSelectUiLanguage(uiLanguage === "en" ? "ja" : "en")}
        />
        <ControlPill label="Kotori writing…" selected={writing} onPress={() => setWriting(!writing)} />
      </View>
    </Card>
  )

  return (
    <PerchEntry
      key={wordKey}
      data={data}
      savedSenses={savedSenses}
      onToggleSave={(sense: Sense) =>
        setSavedSenses((previous) => {
          const next = new Set(previous)
          if (next.has(sense.index)) next.delete(sense.index)
          else next.add(sense.index)
          return next
        })
      }
      onBack={() => {
        if (router.canGoBack()) router.back()
      }}
      onShare={() => {}}
      onOpen={() => {}}
      waiting={writing}
      plain={plain}
      ask={{ pending: false, done: askedKotori, onPress: () => setAskedKotori(true) }}
      demoAudio={!plain}
      footer={controls}
    />
  )
}

export default function EntryPrototypeScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    word?: string | string[]
    theme?: string | string[]
    ui?: string | string[]
  }>()
  const [storedTheme] = useThemeName()
  const activeOverride = useDevThemeOverride()
  const wordKey = parseWord(params.word)
  const uiLanguage = parseUiLanguage(params.ui)
  const palette = parsePalette(params.theme, activeOverride ?? storedTheme)

  useEffect(() => {
    setDevThemeOverride(palette)
    return () => setDevThemeOverride(null)
  }, [palette])

  useEffect(() => {
    setDevLanguageOverride(uiLanguage)
    return () => setDevLanguageOverride(null)
  }, [uiLanguage])

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const next = WORD_KEYS[Number(event.key) - 1]
      if (next !== undefined) router.setParams({ word: next })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [router])

  return (
    <PrototypeLanguageProvider language={uiLanguage}>
      <PerchSurface
        wordKey={wordKey}
        onSelectWord={(next) => router.setParams({ word: next })}
        palette={palette}
        onSelectPalette={(next) => router.setParams({ theme: next })}
        uiLanguage={uiLanguage}
        onSelectUiLanguage={(next) => router.setParams({ ui: next })}
      />
    </PrototypeLanguageProvider>
  )
}
