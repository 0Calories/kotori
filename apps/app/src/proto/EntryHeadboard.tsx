import type { Entry, Language } from "@kotori/contracts"
import { useEffect, useRef, useState } from "react"
import { View } from "react-native"
import { AudioButton } from "../components/AudioButton.tsx"
import { Button, IconButton } from "../components/Button.tsx"
import { Headword } from "../components/Headword.tsx"
import { Icon } from "../components/Icon.tsx"
import { ChipRow } from "../components/LabelChips.tsx"
import { KotoriNotesBadge } from "../components/KotoriMark.tsx"
import { Snow } from "../components/Snow.tsx"
import { Text } from "../components/Text.tsx"
import { posLabel } from "../i18n/strings.ts"
import { heroItems, loanLine } from "../lib/entry.ts"
import { useInterfaceLanguage, useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { GrammarTags, pebbleLift } from "./ChipVariants.tsx"
import { useChipVariant } from "./chipVariant.tsx"
import { protoHeroItems } from "./frequency.ts"
import { heroGrammarTags } from "./grammar.ts"

type EntryForm = Entry["forms"][number]

/** A headword as large as fits: 64pt for short Japanese words and 52pt for short English ones, smaller for long ones. */
export const headwordSize = (headword: string, language: Language) => {
  const length = Array.from(headword).length
  if (language === "en") return length <= 8 ? 52 : Math.max(30, Math.floor(420 / length))
  return length <= 4 ? 64 : Math.max(36, Math.floor(280 / length))
}

const FormTokenRow = ({
  label,
  forms,
  language,
  onTint
}: {
  readonly label: string
  readonly forms: ReadonlyArray<EntryForm>
  readonly language: Language
  readonly onTint: boolean
}) => {
  const { color } = useTheme()
  if (forms.length === 0) return null
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4.5 }}>
      <Text variant="caption" color="textFaint" style={{ fontSize: 11.5, lineHeight: 16 }}>
        {label}
      </Text>
      {forms.map((form) => (
        <View
          key={`${form.kind}:${form.text}`}
          style={{
            paddingHorizontal: 6,
            paddingVertical: 1.5,
            borderRadius: 5,
            backgroundColor: onTint ? "rgba(255, 255, 255, 0.66)" : color.surfaceMuted,
            borderWidth: 1,
            borderColor: fade(color.ink, 0.07)
          }}
        >
          <Text
            jp={language === "ja"}
            variant="caption"
            weight="medium"
            selectable
            style={{ color: color.text, fontSize: 12, lineHeight: 15.5 }}
          >
            {form.text}
          </Text>
        </View>
      ))}
    </View>
  )
}

const FormsAndOrigin = ({
  others,
  inflections,
  origin,
  language,
  onTint
}: {
  readonly others: ReadonlyArray<EntryForm>
  readonly inflections: ReadonlyArray<EntryForm>
  readonly origin: string | null
  readonly language: Language
  readonly onTint: boolean
}) => {
  const { color } = useTheme()
  const { t } = useSession()
  if (others.length === 0 && inflections.length === 0 && origin === null) return null

  return (
    <View style={{ gap: 5 }}>
      {others.length > 0 || inflections.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 5 }}>
          <FormTokenRow label={t.entry.forms} forms={others} language={language} onTint={onTint} />
          <FormTokenRow label={t.entry.inflections} forms={inflections} language={language} onTint={onTint} />
        </View>
      ) : null}
      {origin ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon name="swap_horiz" size={13.5} color={color.textMuted} />
          <Text variant="caption" color="textMuted" selectable style={{ fontSize: 12, lineHeight: 16.5, flex: 1 }}>
            {origin}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const HeadboardAudio = ({
  audioUrl,
  demoAudio,
  mode
}: {
  readonly audioUrl: string | null
  readonly demoAudio: boolean
  readonly mode: "speaker" | "old"
}) => {
  const { color } = useTheme()
  const { t } = useSession()
  const [demoPlaying, setDemoPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    []
  )

  const triggerDemo = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setDemoPlaying(true)
    timerRef.current = setTimeout(() => setDemoPlaying(false), 850)
  }

  if (!audioUrl && !demoAudio) return null

  if (mode === "old") {
    if (audioUrl) return <AudioButton url={audioUrl} label={t.common.listen} />
    return <Button label={t.common.listen} icon="play_arrow" onPress={triggerDemo} />
  }

  return (
    <View style={[{ borderRadius: 22 }, pebbleLift(color.shadow)]}>
      {audioUrl ? (
        <AudioButton url={audioUrl} size={44} />
      ) : (
        <IconButton
          icon="volume_up"
          label={t.common.listen}
          tone="surface"
          size={44}
          active={demoPlaying}
          onPress={triggerDemo}
        />
      )}
    </View>
  )
}

/**
 * Entry headboard (locked in on Variant `A` — `Nest Shelf`, with `OLD` preserved as baseline):
 * Two-zone architectural card pairing `Headword + reading` with a top-right 44pt porcelain speaker
 * button, soft-stone grammar keycaps + form tokens tucked underneath, and a hairline-divided shelf
 * of Snow Pebbles below.
 */
export const EntryHeadboard = ({
  data,
  plain,
  demoAudio = false
}: {
  readonly data: Entry
  readonly plain: boolean
  readonly demoAudio?: boolean
}) => {
  const theme = useTheme()
  const { t } = useSession()
  const uiLanguage = useInterfaceLanguage()
  const variant = useChipVariant()
  const language = data.language
  const size = headwordSize(data.headword, language)
  const reading = data.reading.length > 0 && data.reading !== data.headword ? data.reading : null
  const others = data.forms.filter(
    (form) => form.kind !== "inflection" && form.text !== data.headword && form.text !== data.reading
  )
  const inflections = data.forms.filter((form) => form.kind === "inflection")
  const origin = loanLine(t, data)
  const chips = variant === "OLD" ? heroItems(t, data) : protoHeroItems(t, uiLanguage, data)
  const grammar = heroGrammarTags(t, uiLanguage, data)
  const showDemoAudio = demoAudio && !plain

  if (variant === "OLD") {
    const firstPos = data.senses[0]?.partsOfSpeech[0]
    const partOfSpeech = firstPos ? (posLabel(t, firstPos.code) ?? firstPos.name) : null
    const meta = [reading, data.usuallyKana ? t.entry.usuallyKana : null, plain ? partOfSpeech : null].filter(
      (part): part is string => part !== null
    )
    const hasAudio = Boolean(data.audioUrl) || showDemoAudio
    return (
      <View
        style={
          plain
            ? { paddingHorizontal: 6, paddingTop: 4, marginBottom: 8, gap: 2 }
            : {
                borderRadius: theme.radius.xl,
                overflow: "hidden",
                backgroundColor: theme.color.primaryTint,
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 18,
                gap: 2
              }
        }
      >
        {plain ? null : <Snow />}
        <Headword
          language={language}
          size={size}
          style={
            language === "en"
              ? { lineHeight: Math.round(size * 1.15) }
              : plain
                ? { lineHeight: size }
                : { lineHeight: Math.round(size * 1.1), letterSpacing: size * 0.02 }
          }
          selectable
          accessibilityRole="header"
        >
          {data.headword}
        </Headword>
        {meta.length > 0 ? (
          <Text
            variant="caption"
            size={14}
            color="textMuted"
            style={{ marginTop: plain ? 16 : 4, lineHeight: plain ? 17 : 18 }}
          >
            {meta.join(" · ")}
          </Text>
        ) : null}
        {origin ? (
          <Text variant="caption" color="textMuted">
            {origin}
          </Text>
        ) : null}
        {others.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t.entry.forms}: {others.map((form) => form.text).join(language === "ja" ? "・" : ", ")}
          </Text>
        ) : null}
        {inflections.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t.entry.inflections}: {inflections.map((form) => form.text).join(", ")}
          </Text>
        ) : null}
        {chips.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <ChipRow items={chips} onTint={!plain} />
          </View>
        ) : null}
        {plain && !hasAudio ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, minHeight: 44 }}>
            <HeadboardAudio audioUrl={data.audioUrl} demoAudio={showDemoAudio} mode="old" />
            <View style={{ flex: 1 }} />
            {partOfSpeech && !plain ? (
              <Text variant="caption" size={13.5} color="textMuted">
                {partOfSpeech}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    )
  }

  return (
    <View
      style={
        plain
          ? { paddingHorizontal: 6, paddingTop: 4, marginBottom: 8 }
          : {
              borderRadius: theme.radius.xl,
              overflow: "hidden",
              backgroundColor: theme.color.primaryTint,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 18
            }
      }
    >
      {plain ? null : <Snow />}
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Headword
            language={language}
            size={size}
            style={
              language === "en"
                ? { lineHeight: Math.round(size * 1.12) }
                : { lineHeight: Math.round(size * 1.08), letterSpacing: size * 0.02 }
            }
            selectable
            accessibilityRole="header"
          >
            {data.headword}
          </Headword>
          {reading ? (
            <Text
              jp={language === "ja"}
              variant="caption"
              size={15}
              weight="medium"
              color="textMuted"
              selectable
              style={{ lineHeight: 20 }}
            >
              {reading}
            </Text>
          ) : null}
        </View>
        <View style={{ paddingTop: 4 }}>
          <HeadboardAudio audioUrl={data.audioUrl} demoAudio={showDemoAudio} mode="speaker" />
        </View>
      </View>

      {grammar.length > 0 || others.length > 0 || inflections.length > 0 || origin !== null ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          <GrammarTags items={grammar} onTint={!plain} />
          <FormsAndOrigin
            others={others}
            inflections={inflections}
            origin={origin}
            language={language}
            onTint={!plain}
          />
        </View>
      ) : null}

      {chips.length > 0 ? (
        <View
          style={{
            marginTop: 13,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: fade(theme.color.ink, 0.07)
          }}
        >
          <ChipRow items={chips} onTint={!plain} />
        </View>
      ) : null}
    </View>
  )
}

/** Footer attribution row explaining Kotori's Notes (`🐦✨ Kotori's Notes [AI]`). */
export const KotoriFooterNote = () => {
  const { t } = useSession()
  const variant = useChipVariant()
  if (variant === "OLD") {
    return (
      <Text variant="caption" color="textFaint">
        {`✦ ${t.entry.kotoriLegend}`}
      </Text>
    )
  }
  return (
    <View style={{ gap: 3 }}>
      <KotoriNotesBadge title={t.entry.sourceKotori} tone="primary" compact />
      <Text variant="caption" color="textFaint" style={{ lineHeight: 16.5 }}>
        {t.entry.kotoriLegend}
      </Text>
    </View>
  )
}
