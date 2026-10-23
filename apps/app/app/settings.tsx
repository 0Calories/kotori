import type { Language } from "@kotori/domain"
import { useRouter } from "expo-router"
import { Switch, View } from "react-native"
import { apiUrl } from "../src/api/config.ts"
import { useHealth } from "../src/api/queries.ts"
import { Button, IconButton } from "../src/components/Button.tsx"
import { Card } from "../src/components/Card.tsx"
import { Icon } from "../src/components/Icon.tsx"
import { Mascot } from "../src/components/Mascot.tsx"
import { Header, Screen, Section } from "../src/components/Screen.tsx"
import { Segmented } from "../src/components/Segmented.tsx"
import { Text } from "../src/components/Text.tsx"
import { usePreference } from "../src/session/preferences.ts"
import { useSession } from "../src/session/SessionProvider.tsx"
import { type Appearance, useTheme } from "../src/theme/ThemeProvider.tsx"

const Stepper = ({
  label,
  value,
  step,
  onChange
}: {
  readonly label: string
  readonly value: number
  readonly step: number
  readonly onChange: (value: number) => void
}) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
    <Text style={{ flex: 1 }}>{label}</Text>
    <IconButton icon="remove" label="−" tone="muted" size={36} onPress={() => onChange(Math.max(value - step, 0))} />
    <Text variant="strong" style={{ minWidth: 40, textAlign: "center" }}>
      {value}
    </Text>
    <IconButton icon="add" label="+" tone="muted" size={36} onPress={() => onChange(Math.min(value + step, 9999))} />
  </View>
)

const Feature = ({ label, on }: { readonly label: string; readonly on: boolean | undefined }) => {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon
        name={on ? "check_circle" : "radio_button_unchecked"}
        filled={on}
        size={20}
        color={on ? theme.color.primaryDark : theme.color.textFaint}
      />
      <Text variant="small">{label}</Text>
    </View>
  )
}

export default function SettingsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { t, profile, updateProfile, signOut } = useSession()
  const health = useHealth()
  const [furigana, setFurigana] = usePreference("furigana", true)
  const [appearance, setAppearance] = usePreference<Appearance>("appearance", "system")
  if (profile === null) return null

  return (
    <Screen
      bottomInset={40}
      header={<Header backIcon="close" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />}
    >
      <Text variant="title" accessibilityRole="header" style={{ paddingHorizontal: 2 }}>
        {t.settings.title}
      </Text>

      <Card style={{ gap: theme.space.lg }}>
        <Text variant="label" color="textMuted">
          {t.settings.learning.toUpperCase()}
        </Text>
        <Segmented<Language>
          value={profile.targetLanguage}
          onChange={(target) => updateProfile({ nativeLanguage: target === "ja" ? "en" : "ja" })}
          options={[
            { value: "ja", label: t.settings.japanese },
            { value: "en", label: t.settings.english }
          ]}
        />
        <Stepper
          label={t.settings.dailyNew}
          value={profile.dailyNewLimit}
          step={5}
          onChange={(dailyNewLimit) => updateProfile({ dailyNewLimit })}
        />
        <Stepper
          label={t.settings.dailyReviews}
          value={profile.dailyReviewLimit}
          step={50}
          onChange={(dailyReviewLimit) => updateProfile({ dailyReviewLimit })}
        />
        <View style={{ gap: 8 }}>
          <Text>{t.settings.appearance}</Text>
          <Segmented<Appearance>
            value={appearance}
            onChange={setAppearance}
            options={(["system", "light", "dark"] as const).map((value) => ({
              value,
              label: t.settings.appearances[value]
            }))}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flex: 1 }}>{t.settings.furigana}</Text>
          <Switch
            value={furigana}
            onValueChange={setFurigana}
            trackColor={{ true: theme.color.primary, false: theme.color.border }}
            thumbColor={theme.color.surface}
            {...{ activeThumbColor: theme.color.surface }}
          />
        </View>
      </Card>

      <Section title={t.settings.server}>
        <Card style={{ gap: theme.space.sm }}>
          <Text variant="caption" color="textMuted">
            {apiUrl}
          </Text>
          <Feature label={`${t.tabs.check} · ${t.tabs.say} (Claude)`} on={health.data?.features.coach} />
          <Feature label={`${t.nuance.formality} (Jev)`} on={health.data?.features.nuance} />
          <Feature label={`${t.common.listen} (ElevenLabs)`} on={health.data?.features.audio} />
          {health.data ? (
            <Text variant="caption" color="textFaint">
              JMDict · {health.data.dictionary.entries.toLocaleString()}
            </Text>
          ) : null}
        </Card>
      </Section>

      <Section title={t.settings.about}>
        <Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Mascot size={56} mood="happy" />
          <Text variant="small" color="textMuted" style={{ flex: 1 }}>
            {t.settings.aboutBody}
          </Text>
        </Card>
      </Section>

      <Section title={t.settings.account}>
        <Card style={{ gap: theme.space.md }}>
          <Text variant="small" color="textMuted">
            {profile.email}
          </Text>
          <Button
            label={t.settings.signOut}
            variant="secondary"
            icon="log-out-outline"
            onPress={() => void signOut()}
          />
        </Card>
      </Section>
    </Screen>
  )
}
