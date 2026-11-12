/**
 * PROTOTYPE: Switchable Proposed Design (`A`) vs PR 151 Baseline (`OLD`) for Snow-Pebble entry
 * chips, Nest Shelf headboard, 5-tier Frequency, curated Snow-Tray search rows, and "Kotori's Notes".
 */
import type { Entry, Language, Sense } from "@kotori/contracts"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Cautions } from "../../src/components/Cautions.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { ExampleRow } from "../../src/components/ExampleRow.tsx"
import { ChipRow } from "../../src/components/LabelChips.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { PrototypeSwitcher } from "../../src/components/PrototypeSwitcher.tsx"
import { ResultRow } from "../../src/components/ResultRow.tsx"
import { Screen, Section } from "../../src/components/Screen.tsx"
import { Text } from "../../src/components/Text.tsx"
import { UsagePatterns } from "../../src/components/UsagePatterns.tsx"
import { posLabel, tagName } from "../../src/i18n/strings.ts"
import {
  contributors,
  hasKotoriContent,
  hasKotoriMarks,
  labelItems,
  senseCautions,
  wordCautions
} from "../../src/lib/entry.ts"
import { findForm } from "../../src/lib/forms.ts"
import { SAMPLE_ENTRIES, SAMPLE_SEARCH_RESULTS, type SampleWordKey } from "../../src/proto/chipSamples.ts"
import {
  CHIP_VARIANTS,
  ChipVariantProvider,
  chipVariantSpec,
  parseChipVariant,
  useChipVariant
} from "../../src/proto/chipVariant.tsx"
import { EntryHeadboard, KotoriFooterNote } from "../../src/proto/EntryHeadboard.tsx"
import { FREQUENCY_TIERS, frequencyTierChip } from "../../src/proto/frequency.ts"
import { heroGrammarTags, senseGrammarTags } from "../../src/proto/grammar.ts"
import {
  PrototypeLanguageProvider,
  setDevLanguageOverride,
  useInterfaceLanguage,
  useSession
} from "../../src/session/SessionProvider.tsx"
import { setDevThemeOverride, useDevThemeOverride, useTheme, useThemeName } from "../../src/theme/ThemeProvider.tsx"
import { fade, type ThemeName } from "../../src/theme/tokens.ts"

const WORD_KEYS: ReadonlyArray<SampleWordKey> = ["kuu", "gokurousama", "manshon", "advice", "kangamiru"]

const parseWord = (raw: string | readonly string[] | undefined): SampleWordKey => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === "kuu" ||
    value === "gokurousama" ||
    value === "manshon" ||
    value === "advice" ||
    value === "kangamiru"
    ? value
    : "kuu"
}

const parseUiLanguage = (raw: string | readonly string[] | undefined): Language => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === "ja" ? "ja" : "en"
}

const parsePalette = (raw: string | readonly string[] | undefined, fallback: ThemeName): ThemeName => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === "wakatake" || value === "sora" ? value : fallback
}

const glossSeparator = (language: Language) => (language === "ja" ? "; " : "、")

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

const ProtoSenseCard = ({
  entry,
  sense,
  number,
  forms,
  partOfSpeech,
  heroTagLabels,
  saved,
  onToggleSave
}: {
  readonly entry: Entry
  readonly sense: Sense
  readonly number: number
  readonly forms: ReadonlyArray<string>
  readonly partOfSpeech: string | null
  readonly heroTagLabels: ReadonlySet<string>
  readonly saved: boolean
  readonly onToggleSave: () => void
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const uiLanguage = useInterfaceLanguage()
  const variant = useChipVariant()
  const language = entry.language
  const [first, second, ...rest] = sense.glosses
  const separator = glossSeparator(language)
  const pos = [...new Set(sense.partsOfSpeech.map((tag) => posLabel(t, tag.code) ?? tag.name))].filter(
    (label) => label !== partOfSpeech
  )
  const fields = sense.fields.map((tag) => tagName(t, tag))
  const senseGrammar = senseGrammarTags(t, uiLanguage, sense, heroTagLabels)

  return (
    <Card style={{ flexDirection: "row", gap: 12, paddingBottom: 12 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: number === 1 ? theme.color.primaryDark : theme.color.primaryTint,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Text
          variant="caption"
          weight="bold"
          size={13}
          style={{ color: number === 1 ? theme.color.onPrimaryDark : theme.color.text, lineHeight: 16 }}
        >
          {number}
        </Text>
      </View>
      <View style={{ flex: 1, gap: theme.space.sm + 2 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 4, paddingTop: 1 }}>
            <Text variant="heading" selectable>
              {second ? `${first}${separator}${second}` : first}
            </Text>
            {rest.length > 0 ? <Text color="textMuted">{rest.join(separator)}</Text> : null}
          </View>
          <View style={{ marginTop: -9, marginRight: -8 }}>
            <IconButton
              icon="bookmark"
              filled={saved}
              size={40}
              label={saved ? t.saved.remove : t.entry.save}
              onPress={onToggleSave}
            />
          </View>
        </View>
        <ChipRow items={labelItems(t, sense.labels)} grammar={senseGrammar} plain={[...pos, ...fields]} />
        <UsagePatterns usagePatterns={sense.usagePatterns} scope={variant === "OLD" ? "all" : "dictionary"} />
        {sense.examples.map((example) => (
          <ExampleRow
            key={example.id}
            example={example}
            language={language}
            mark={findForm(language === "ja" ? example.ja : example.en, forms, language)}
          />
        ))}
        {variant === "OLD" ? null : <UsagePatterns usagePatterns={sense.usagePatterns} scope="kotori" />}
        <Cautions cautions={senseCautions(entry.cautions, sense.index)} headline={false} />
        {sense.antonyms.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Text variant="caption" color="textFaint">
              {t.entry.antonyms}
            </Text>
            {sense.antonyms.map((ref) => (
              <PressableScale key={ref.text} onPress={() => {}}>
                <Chip icon="swap_horiz" label={ref.text} />
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  )
}

const EntrySurface = ({
  wordKey,
  onSelectWord,
  palette,
  onSelectPalette,
  uiLanguage,
  onSelectUiLanguage,
  variantKey
}: {
  readonly wordKey: SampleWordKey
  readonly onSelectWord: (next: SampleWordKey) => void
  readonly palette: ThemeName
  readonly onSelectPalette: (next: ThemeName) => void
  readonly uiLanguage: Language
  readonly onSelectUiLanguage: (next: Language) => void
  readonly variantKey: ReturnType<typeof parseChipVariant>
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const [savedSenses, setSavedSenses] = useState<ReadonlySet<number>>(() => new Set([0]))
  const [askedKotori, setAskedKotori] = useState(false)
  const data = SAMPLE_ENTRIES[wordKey].entry
  const spec = chipVariantSpec(variantKey)
  const language = data.language
  const firstPos = data.senses[0]?.partsOfSpeech[0]
  const partOfSpeech = firstPos ? (posLabel(t, firstPos.code) ?? firstPos.name) : null
  const heroTagLabels = new Set(heroGrammarTags(t, uiLanguage, data).map((item) => item.label))
  const forms = [data.headword, ...data.forms.map((form) => form.text), ...(language === "ja" ? [data.reading] : [])]
  const plain = !hasKotoriContent(data)

  const toggleSense = (idx: number) => {
    setSavedSenses((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <Screen bottomInset={112}>
      {/* Prototype Controls + Surfaced State */}
      <Card tone="muted" style={{ gap: 10, padding: 14 }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8
          }}
        >
          <Text variant="label" color="textMuted" style={{ textTransform: "uppercase" }}>
            {`PROTOTYPE · ENTRY CHIPS & SEARCH ROWS · ${spec.key} (${spec.name})`}
          </Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <ControlPill label="Sora" selected={palette === "sora"} onPress={() => onSelectPalette("sora")} />
            <ControlPill
              label="Wakatake"
              selected={palette === "wakatake"}
              onPress={() => onSelectPalette("wakatake")}
            />
            <ControlPill
              label={uiLanguage === "en" ? "UI: EN" : "UI: 日本語"}
              selected={uiLanguage === "ja"}
              onPress={() => onSelectUiLanguage(uiLanguage === "en" ? "ja" : "en")}
            />
          </View>
        </View>

        <Text variant="small" color="text">
          {spec.tagline}
        </Text>

        <View style={{ gap: 2 }}>
          <Text variant="caption" color="textMuted">
            {`• Search rows: ${spec.searchRowRule}`}
          </Text>
          <Text variant="caption" color="textMuted">
            {`• Kotori's Notes: ${spec.kotoriNotesRule}`}
          </Text>
          <Text variant="caption" color="textMuted">
            {`• Entry headboard: ${spec.entryLockedRule}`}
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
          {WORD_KEYS.map((key) => (
            <ControlPill
              key={key}
              label={SAMPLE_ENTRIES[key].label}
              selected={wordKey === key}
              onPress={() => {
                setAskedKotori(false)
                onSelectWord(key)
              }}
            />
          ))}
        </View>
      </Card>

      {/* Redesigned Entry Headboard */}
      <EntryHeadboard data={data} plain={plain} demoAudio />

      <Cautions cautions={wordCautions(data.cautions)} headline />

      <Section title={data.senses.length === 1 ? t.entry.meaning : t.entry.meanings}>
        {data.senses.map((sense, index) => (
          <ProtoSenseCard
            key={sense.index}
            entry={data}
            sense={sense}
            number={index + 1}
            forms={forms}
            partOfSpeech={partOfSpeech}
            heroTagLabels={heroTagLabels}
            saved={savedSenses.has(sense.index)}
            onToggleSave={() => toggleSense(sense.index)}
          />
        ))}
      </Section>

      {plain ? (
        <View
          style={{
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.lg,
            padding: theme.space.lg,
            gap: 14
          }}
        >
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: theme.color.surface,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Mascot size={36} mood="sleepy" />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="strong" weight="bold" size={15}>
                {t.entry.dictionaryOnly}
              </Text>
              <Text variant="small" color="textMuted">
                {t.entry.dictionaryOnlyBody(data.headword)}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-start" }}>
            <Button
              variant="secondary"
              icon={askedKotori ? "check" : "add"}
              label={t.entry.ask}
              disabled={askedKotori}
              onPress={() => setAskedKotori(true)}
            />
          </View>
        </View>
      ) : null}

      {/* Search ResultRow preview + 5-tier Frequency scale */}
      <Section title="In search results">
        <Card tone="primary" style={{ gap: 8, paddingVertical: 12, paddingHorizontal: 14 }}>
          <Text variant="caption" weight="semibold" style={{ color: theme.color.primaryDeep }}>
            Frequency tiers (tap or hover each Snow Pebble):
          </Text>
          <ChipRow items={FREQUENCY_TIERS.map((tier) => frequencyTierChip(uiLanguage, tier))} onTint />
        </Card>
        <Card list padded={false} style={{ paddingHorizontal: theme.space.lg }}>
          {SAMPLE_SEARCH_RESULTS.map((row, index) => (
            <ResultRow key={row.id} entry={row} first={index === 0} demoAudio onPress={() => {}} />
          ))}
        </Card>
      </Section>

      <View style={{ paddingHorizontal: 6, gap: 8 }}>
        <Text variant="caption" color="textFaint">
          <Text variant="caption" weight="semibold" color="textMuted" style={{ textDecorationLine: "underline" }}>
            {t.entry.sources}
          </Text>
          {t.entry.sourcesList(contributors(t, data))}
        </Text>
        {hasKotoriMarks(data) ? <KotoriFooterNote /> : null}
      </View>
    </Screen>
  )
}

export default function EntryChipsPrototypeScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    variant?: string | string[]
    word?: string | string[]
    theme?: string | string[]
    ui?: string | string[]
  }>()
  const [storedTheme] = useThemeName()
  const activeOverride = useDevThemeOverride()
  const variant = parseChipVariant(params.variant)
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

  const stateSummary = `${SAMPLE_ENTRIES[wordKey].entry.headword} · ${palette} · UI ${uiLanguage.toUpperCase()} · ←/→ keys`

  return (
    <PrototypeLanguageProvider language={uiLanguage}>
      <ChipVariantProvider variant={variant}>
        <EntrySurface
          wordKey={wordKey}
          onSelectWord={(next) => router.setParams({ word: next })}
          palette={palette}
          onSelectPalette={(next) => router.setParams({ theme: next })}
          uiLanguage={uiLanguage}
          onSelectUiLanguage={(next) => router.setParams({ ui: next })}
          variantKey={variant}
        />
        <PrototypeSwitcher
          variants={CHIP_VARIANTS}
          current={variant}
          stateSummary={stateSummary}
          onSelect={(next) => router.setParams({ variant: next })}
        />
      </ChipVariantProvider>
    </PrototypeLanguageProvider>
  )
}
