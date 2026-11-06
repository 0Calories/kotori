/**
 * PROTOTYPE. The entry page as the proposed model would render it. Compare with `app/entry/[id].tsx`:
 * no nuance card, no sliders, no caution chips. In their place: label chips coloured by severity
 * that explain themselves on tap, patterns and examples inside each sense, Kotori's added context
 * marked ✦ beside the dictionary's notes, a "watch out" block for pitfalls that aren't obvious
 * from the labels, and a sources line at the bottom.
 */
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { Platform, Pressable, type StyleProp, View, type ViewStyle } from "react-native"
import { Button, IconButton } from "../../src/components/Button.tsx"
import { Card } from "../../src/components/Card.tsx"
import { Chip } from "../../src/components/Chip.tsx"
import { Furigana } from "../../src/components/Furigana.tsx"
import { Headword } from "../../src/components/Headword.tsx"
import { Icon, type IconName } from "../../src/components/Icon.tsx"
import { MarkedText } from "../../src/components/MarkedText.tsx"
import { Mascot } from "../../src/components/Mascot.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { Header, Screen, Section } from "../../src/components/Screen.tsx"
import { Snow } from "../../src/components/Snow.tsx"
import { Text } from "../../src/components/Text.tsx"
import { findForm } from "../../src/lib/forms.ts"
import {
  contributors,
  derivedDifference,
  hasKotoriMarks,
  type HeroChip,
  loanChip,
  ownLabels,
  pitfallIcon,
  type ProtoStrings,
  severity,
  type Severity,
  stringsFor,
  usageChip,
  wordLabels
} from "../../src/proto/display.ts"
import { byId } from "../../src/proto/mock.ts"
import type { Entry, Example, Label, Pattern, Pitfall, Sense } from "../../src/proto/model.ts"
import { useTheme } from "../../src/theme/ThemeProvider.tsx"

const headwordSize = (headword: string, language: Entry["language"]) => {
  const length = Array.from(headword).length
  if (language === "en") return length <= 8 ? 52 : Math.max(30, Math.floor(420 / length))
  return length <= 4 ? 64 : Math.max(36, Math.floor(280 / length))
}

/** Amber for cautions: the palette has green for good news and rose for warnings, nothing between. */
const AMBER = { fg: "#7A4E00", bg: "#FFF3D6", ring: "#F3DFA8" }

/**
 * A chip coloured by how loudly it should speak. Tap (or hover, on the web) to read the sentence
 * behind it, which appears under the row of chips. A `kotori` chip carries the ✦ mark.
 */
const SeverityChip = ({
  label,
  tone,
  icon,
  kotori,
  onTint = false,
  open,
  onToggle,
  style
}: {
  readonly label: string
  readonly tone: Severity
  readonly icon?: IconName
  readonly kotori?: boolean
  /** On the hero's tint a green chip would vanish, so it sits on white there. */
  readonly onTint?: boolean
  readonly open: boolean
  readonly onToggle: () => void
  readonly style?: StyleProp<ViewStyle>
}) => {
  const { color } = useTheme()
  const colors = {
    quiet: { fg: color.textMuted, bg: "transparent", ring: color.border },
    info: onTint
      ? { fg: color.primaryDeep, bg: color.surface, ring: color.surface }
      : { fg: color.primaryDeep, bg: color.primaryTint, ring: color.primaryTint },
    caution: AMBER,
    avoid: { fg: color.accent, bg: color.accentSoft, ring: color.accentSoft }
  }[tone]
  return (
    <Pressable
      onPress={onToggle}
      onHoverIn={Platform.OS === "web" ? onToggle : undefined}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          minHeight: 26,
          paddingVertical: 4,
          paddingHorizontal: 10,
          backgroundColor: colors.bg,
          borderWidth: 1,
          borderColor: open ? colors.fg : colors.ring,
          borderRadius: 13,
          alignSelf: "flex-start"
        },
        style
      ]}
    >
      {icon ? <Icon name={icon} size={15} color={colors.fg} /> : null}
      <Text variant="caption" style={{ color: colors.fg, lineHeight: 16 }}>
        {label}
      </Text>
      {kotori ? (
        <Text variant="caption" style={{ color: colors.fg, lineHeight: 16 }}>
          ✦
        </Text>
      ) : null}
    </Pressable>
  )
}

interface ChipItem {
  readonly key: string
  readonly label: string
  readonly help: string
  readonly tone: Severity
  readonly icon?: IconName
  readonly kotori?: boolean
}

const labelItems = (t: ProtoStrings, labels: ReadonlyArray<Label>): ReadonlyArray<ChipItem> =>
  labels.map((label) => ({
    key: label.code,
    label: t.labels[label.code],
    help: label.source === "kotori" ? `${t.labelHelp[label.code]} ✦ ${t.byKotoriHelp}` : t.labelHelp[label.code],
    tone: severity[label.code],
    kotori: label.source === "kotori"
  }))

const heroItems = (chips: ReadonlyArray<HeroChip | null>): ReadonlyArray<ChipItem> =>
  chips.flatMap((chip) =>
    chip === null ? [] : [{ key: chip.key, label: chip.label, help: chip.help, tone: chip.severity, icon: chip.icon }]
  )

/** A row of chips with one explanation open at a time, written under the row. */
const ChipRow = ({
  items,
  plain,
  language,
  onTint = false
}: {
  readonly items: ReadonlyArray<ChipItem>
  readonly onTint?: boolean
  /** Chips with no explanation, such as parts of speech, drawn in the neutral outline. */
  readonly plain?: ReadonlyArray<string>
  readonly language: Entry["language"]
}) => {
  const theme = useTheme()
  const [open, setOpen] = useState<string | null>(null)
  const shown = items.find((item) => item.key === open)
  if (items.length + (plain?.length ?? 0) === 0) return null
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {plain?.map((label) => (
          <Chip key={label} label={label} />
        ))}
        {items.map((item) => (
          <SeverityChip
            key={item.key}
            label={item.label}
            tone={item.tone}
            icon={item.icon}
            kotori={item.kotori}
            onTint={onTint}
            open={open === item.key}
            onToggle={() => setOpen(open === item.key ? null : item.key)}
          />
        ))}
      </View>
      {shown ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", paddingLeft: 2 }}>
          <Icon name="info" size={14} color={theme.color.textFaint} />
          <Text jp={language === "en"} variant="caption" color="textMuted" style={{ flex: 1 }}>
            {shown.help}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Usage notes on a sense. The dictionary's are plain; Kotori's are set on a tint with the ✦ mark,
 * so the learner knows which is the editors' and which is added context.
 */
const Patterns = ({
  t,
  language,
  patterns
}: {
  readonly t: ProtoStrings
  readonly language: Entry["language"]
  readonly patterns: ReadonlyArray<Pattern>
}) => {
  const theme = useTheme()
  const router = useRouter()
  if (patterns.length === 0) return null
  return (
    <View style={{ gap: 6 }}>
      {patterns.map((pattern) => {
        const about = pattern.about === undefined ? undefined : byId.get(pattern.about)
        if (pattern.source !== "kotori") {
          return (
            <View key={pattern.text} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
              <Icon name="arrow_right_alt" size={16} color={theme.color.textFaint} />
              <Text jp={language === "en"} variant="small" color="textMuted" style={{ flex: 1 }}>
                {pattern.text}
              </Text>
            </View>
          )
        }
        return (
          <View
            key={pattern.text}
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "flex-start",
              backgroundColor: theme.color.primaryTint,
              borderRadius: theme.radius.sm,
              paddingVertical: 8,
              paddingHorizontal: 10
            }}
          >
            <Text variant="caption" style={{ color: theme.color.primaryDeep, lineHeight: 18 }}>
              ✦
            </Text>
            <View style={{ flex: 1, gap: 6 }}>
              <Text jp={language === "en"} variant="small" style={{ color: theme.color.primaryDeep }}>
                {pattern.text}
              </Text>
              {about ? (
                <PressableScale
                  onPress={() => router.push({ pathname: "/proto/[id]", params: { id: String(about.id) } })}
                  style={{ alignSelf: "flex-start" }}
                >
                  <Chip tone="primary" icon="arrow_forward" label={`${t.compare} ${about.headword}`} />
                </PressableScale>
              ) : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const ExampleRow = ({
  t,
  example,
  language,
  mark
}: {
  readonly t: ProtoStrings
  readonly example: Example
  readonly language: Entry["language"]
  readonly mark: string | undefined
}) => {
  const theme = useTheme()
  const english = language === "en"
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.sm,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 8
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        {english ? (
          <>
            <MarkedText text={example.en} mark={mark} />
            <Text jp variant="small" color="textMuted">
              {example.ja}
            </Text>
          </>
        ) : (
          <>
            <Furigana
              text={example.ja}
              furigana={example.furigana}
              size={16}
              marks={mark ? [{ text: mark, kind: "highlight" }] : []}
            />
            <Text variant="small" color="textMuted">
              {example.en}
            </Text>
          </>
        )}
        {example.source !== "kotori" ? (
          <Text variant="caption" color="textFaint" style={{ marginTop: 2 }}>
            {t.source[example.source]}
          </Text>
        ) : null}
      </View>
      {example.audio ? <IconButton icon="volume_up" tone="surface" label={t.listen} onPress={() => {}} /> : null}
    </View>
  )
}

/** One pitfall: its kind as an overline, the text, and a link to the word to compare with. */
const PitfallRow = ({
  t,
  pitfall,
  language
}: {
  readonly t: ProtoStrings
  readonly pitfall: Pitfall
  readonly language: Entry["language"]
}) => {
  const theme = useTheme()
  const router = useRouter()
  const about = pitfall.about === undefined ? undefined : byId.get(pitfall.about)
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={pitfallIcon[pitfall.kind]} size={18} color={theme.color.accent} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
          {t.pitfall[pitfall.kind]}
        </Text>
        <Text jp={language === "en"} variant="small">
          {pitfall.text}
        </Text>
        {about ? (
          <PressableScale
            onPress={() => router.push({ pathname: "/proto/[id]", params: { id: String(about.id) } })}
            style={{ alignSelf: "flex-start", marginTop: 2 }}
          >
            <Chip icon="arrow_forward" label={`${t.compare} ${about.headword}`} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  )
}

const Pitfalls = ({
  t,
  pitfalls,
  language,
  headline
}: {
  readonly t: ProtoStrings
  readonly pitfalls: ReadonlyArray<Pitfall>
  readonly language: Entry["language"]
  readonly headline: boolean
}) => {
  const theme = useTheme()
  if (pitfalls.length === 0) return null
  return (
    <Card tone="accent" padded={headline} style={headline ? { gap: 12 } : { gap: 12, padding: 12 }}>
      {headline ? (
        <Text variant="label" style={{ color: theme.color.accent, textTransform: "uppercase" }}>
          {t.watchOut}
        </Text>
      ) : null}
      {pitfalls.map((pitfall) => (
        <PitfallRow key={pitfall.id} t={t} pitfall={pitfall} language={language} />
      ))}
    </Card>
  )
}

const SenseCard = ({
  t,
  entry,
  sense,
  number,
  forms,
  partOfSpeech
}: {
  readonly t: ProtoStrings
  readonly entry: Entry
  readonly sense: Sense
  readonly number: number
  readonly forms: ReadonlyArray<string>
  /** Already in the hero; repeated only when this sense differs. */
  readonly partOfSpeech: string | null
}) => {
  const theme = useTheme()
  const language = entry.language
  const [first, second, ...rest] = sense.glosses
  const separator = language === "ja" ? "; " : "、"
  const pos = sense.pos.filter((label) => label !== partOfSpeech)
  const labels = ownLabels(entry, sense)
  const pitfalls = entry.pitfalls.filter((pitfall) => pitfall.sense === sense.index)
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
        <View style={{ gap: 4, paddingTop: 1 }}>
          <Text variant="heading" jp={language === "en"} selectable>
            {second ? `${first}${separator}${second}` : first}
          </Text>
          {rest.length > 0 ? (
            <Text color="textMuted" jp={language === "en"}>
              {rest.join(separator)}
            </Text>
          ) : null}
        </View>
        <ChipRow items={labelItems(t, labels)} plain={[...pos, ...sense.fields]} language={language} />
        <Patterns t={t} language={language} patterns={sense.patterns} />
        {sense.examples.map((example) => (
          <ExampleRow
            key={example.id}
            t={t}
            example={example}
            language={language}
            mark={findForm(language === "ja" ? example.ja : example.en, forms, language)}
          />
        ))}
        <Pitfalls t={t} pitfalls={pitfalls} language={language} headline={false} />
      </View>
    </Card>
  )
}

/** Near-synonyms from the dictionary's cross-references, each with a difference read off the labels. */
const Similar = ({ t, entry }: { readonly t: ProtoStrings; readonly entry: Entry }) => {
  const theme = useTheme()
  const router = useRouter()
  const rows = [
    ...new Map(
      entry.senses.flatMap((sense) =>
        sense.similar.flatMap((id) => {
          const other = byId.get(id)
          return other === undefined ? [] : [[id, { other, own: sense }] as const]
        })
      )
    ).values()
  ]
  if (rows.length === 0) return null
  return (
    <Section title={t.similar}>
      <Text variant="small" color="textMuted" style={{ paddingHorizontal: 6, marginTop: -4 }}>
        {t.similarIntro(entry.headword)}
      </Text>
      <Card padded={false} style={{ paddingHorizontal: theme.space.lg, paddingVertical: 2 }}>
        {rows.map(({ other, own }, index) => {
          const otherSense = other.senses.find((sense) => sense.similar.includes(entry.id)) ?? other.senses[0]!
          const difference = derivedDifference(t, own.labels, otherSense.labels)
          return (
            <PressableScale
              key={other.id}
              scaleTo={0.98}
              accessibilityRole="link"
              onPress={() => router.push({ pathname: "/proto/[id]", params: { id: String(other.id) } })}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.color.divider
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                  <Headword
                    language={other.language}
                    size={other.language === "ja" ? 23 : 20}
                    style={{ lineHeight: 28 }}
                  >
                    {other.headword}
                  </Headword>
                  {other.reading.length > 0 && other.reading !== other.headword ? (
                    <Text jp={other.language === "ja"} variant="caption" color="textMuted">
                      {other.reading}
                    </Text>
                  ) : null}
                </View>
                <Text variant="small" color="textMuted" numberOfLines={2}>
                  <Text variant="small" weight="semibold">
                    {difference}
                  </Text>
                  {` · ${otherSense.glosses.slice(0, 2).join(other.language === "ja" ? "; " : "、")}`}
                </Text>
              </View>
              <Icon name="chevron_right" size={22} color={theme.color.textMuted} />
            </PressableScale>
          )
        })}
      </Card>
    </Section>
  )
}

export default function ProtoEntry() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const entry = byId.get(Number(id))
  const [showAll, setShowAll] = useState(false)
  const [showData, setShowData] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace("/proto"))

  if (entry === undefined) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <Text>No such prototype entry.</Text>
      </Screen>
    )
  }

  const t = stringsFor(entry.language)
  const language = entry.language
  const reading = entry.reading.length > 0 && entry.reading !== entry.headword ? entry.reading : null
  const size = headwordSize(entry.headword, language)
  const others = entry.forms.filter(
    (form) => form.kind !== "inflection" && form.text !== entry.headword && form.text !== entry.reading
  )
  const inflections = entry.forms.filter((form) => form.kind === "inflection")
  const forms = [entry.headword, ...entry.forms.map((form) => form.text), ...(language === "ja" ? [entry.reading] : [])]
  const senses = showAll ? entry.senses : entry.senses.slice(0, 3)
  const partOfSpeech = entry.senses[0]?.pos[0] ?? null
  const wordPitfalls = entry.pitfalls.filter((pitfall) => pitfall.sense === null)
  const byKotori =
    entry.pitfalls.length > 0 ||
    entry.senses.some(
      (sense) =>
        sense.examples.some((example) => example.source === "kotori") ||
        sense.labels.some((label) => label.source === "kotori")
    )
  const hasExamples = entry.senses.some((sense) => sense.examples.length > 0)
  const plain = !byKotori && !hasExamples
  const meta = [reading, entry.usuallyKana ? t.usuallyKana : null, plain ? partOfSpeech : null].filter(
    (part): part is string => part !== null
  )
  const loanLine =
    entry.loan === null || language !== "ja"
      ? null
      : entry.loan.meaning === "divergent"
        ? t.fromDiverged(entry.loan.english)
        : entry.loan.meaning === "same"
          ? t.fromSame(entry.loan.english)
          : t.from(entry.loan.english)
  const heroChips = [...heroItems([usageChip(t, entry), loanChip(t, entry)]), ...labelItems(t, wordLabels(entry))]

  return (
    <Screen bottomInset={40} header={<Header onBack={back} />}>
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
          style={language === "en" ? { lineHeight: Math.round(size * 1.15) } : { lineHeight: Math.round(size * 1.1) }}
          selectable
          accessibilityRole="header"
        >
          {entry.headword}
        </Headword>
        {meta.length > 0 ? (
          <Text variant="caption" size={14} color="textMuted" style={{ marginTop: plain ? 14 : 4 }}>
            {meta.join(" · ")}
          </Text>
        ) : null}
        {loanLine ? (
          <Text variant="caption" color="textMuted">
            {loanLine}
          </Text>
        ) : null}
        {others.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t.forms}: {others.map((form) => form.text).join(language === "ja" ? "・" : ", ")}
          </Text>
        ) : null}
        {inflections.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t.inflections}: {inflections.map((form) => form.text).join(", ")}
          </Text>
        ) : null}
        <View style={{ marginTop: 10 }}>
          <ChipRow items={heroChips} language={language} onTint={!plain} />
        </View>
        {plain && !entry.audio ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, minHeight: 44 }}>
            {entry.audio ? <Button label={t.listen} icon="play_arrow" variant="secondary" onPress={() => {}} /> : null}
            <View style={{ flex: 1 }} />
            {partOfSpeech && !plain ? (
              <Text variant="caption" size={13.5} color="textMuted">
                {partOfSpeech}
              </Text>
            ) : null}
          </View>
        )}
      </View>

      <Pitfalls t={t} pitfalls={wordPitfalls} language={language} headline />

      <Section title={entry.senses.length === 1 ? t.meaning : t.meanings}>
        {senses.map((sense, index) => (
          <SenseCard
            key={sense.index}
            t={t}
            entry={entry}
            sense={sense}
            number={index + 1}
            forms={forms}
            partOfSpeech={partOfSpeech}
          />
        ))}
        {entry.senses.length > 3 ? (
          <Button
            variant="ghost"
            label={showAll ? t.less : `${t.more} (${entry.senses.length - 3})`}
            onPress={() => setShowAll(!showAll)}
          />
        ) : null}
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
                {t.dictionaryOnly}
              </Text>
              <Text variant="small" color="textMuted" jp={language === "en"}>
                {t.dictionaryOnlyBody(entry.headword)}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-start" }}>
            <Button variant="secondary" icon="add" label={t.ask} onPress={() => {}} />
          </View>
        </View>
      ) : null}

      <Similar t={t} entry={entry} />

      <View style={{ paddingHorizontal: 6, gap: 10 }}>
        <Text variant="caption" color="textFaint">
          {t.sources}: {t.sourceLine(contributors(t, entry))}
        </Text>
        {hasKotoriMarks(entry) ? (
          <Text variant="caption" color="textFaint" jp={language === "en"}>
            {t.legendKotori}
          </Text>
        ) : null}
        <PressableScale onPress={() => setShowData(!showData)} style={{ alignSelf: "flex-start" }}>
          <Text variant="caption" weight="semibold" style={{ textDecorationLine: "underline" }}>
            {showData ? t.hideData : t.showData}
          </Text>
        </PressableScale>
        {showData ? (
          <Card tone="muted">
            <Text variant="caption" style={{ fontFamily: "monospace" }} selectable>
              {JSON.stringify({ ...entry, tests: undefined }, null, 2)}
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  )
}
