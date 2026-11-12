import { View } from "react-native"
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg"
import { frontShapes, palette, sparklePath } from "../mascot/geometry.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { fade } from "../theme/tokens.ts"
import { Text } from "./Text.tsx"

/**
 * Crisp static miniature of Kotori (the shima-enaga snow bird) cropped to its round head, tuft,
 * rosy cheeks and beak so it reads clearly at chip and badge sizes (14–28pt) without mounting
 * animation channels. `sparkle` adds Kotori's golden 4-point glint at the brow.
 */
export const KotoriMark = ({
  size = 18,
  mood = "happy",
  sparkle = true
}: {
  readonly size?: number
  readonly mood?: "neutral" | "happy"
  readonly sparkle?: boolean
}) => (
  <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no">
    <Svg width={size} height={size} viewBox="18 14 164 162">
      <Path d={frontShapes.wings[0]} fill={palette.ink} />
      <Path d={frontShapes.wings[1]} fill={palette.ink} />
      {frontShapes.tuft.map((t) => (
        <Circle key={t.cx} cx={t.cx} cy={t.cy} r={t.r + 1} fill={palette.white} />
      ))}
      <Path d={frontShapes.body} fill={palette.white} stroke={fade(palette.ink, 0.14)} strokeWidth={4} />
      <Path d={frontShapes.shade} fill={palette.shade} fillOpacity={0.65} />
      {frontShapes.cheeks.map((c) => (
        <Ellipse key={c.cx} cx={c.cx} cy={c.cy + 2} rx={c.rx * 1.25} ry={c.ry * 1.25} fill={palette.blush} />
      ))}
      {mood === "happy"
        ? frontShapes.eyes.map((e) => (
            <Path
              key={e.cx}
              d={`M${e.cx - 8.5} ${e.cy + 3} Q ${e.cx} ${e.cy - 8.5} ${e.cx + 8.5} ${e.cy + 3}`}
              stroke={palette.ink}
              strokeWidth={5.8}
              strokeLinecap="round"
              fill="none"
            />
          ))
        : frontShapes.eyes.map((e) => (
            <G key={e.cx}>
              <Ellipse cx={e.cx} cy={e.cy} rx={e.rx * 1.15} ry={e.ry * 1.15} fill={palette.ink} />
              <Circle
                cx={e.cx + frontShapes.catchlight.dx}
                cy={e.cy + frontShapes.catchlight.dy}
                r={frontShapes.catchlight.r * 1.15}
                fill={palette.white}
              />
            </G>
          ))}
      <Path d={frontShapes.beak} fill={palette.ink} />
      {sparkle ? (
        <Path
          d={sparklePath({ cx: 158, cy: 38, r: 24 })}
          fill={palette.gold}
          stroke={palette.white}
          strokeWidth={5}
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  </View>
)

/**
 * On-brand attribution lockup for "Kotori's Notes": pairs the cute shima-enaga bird + sparkle with
 * an explicit `AI` micro-badge so learners always know the note is AI-generated.
 */
export const KotoriNotesBadge = ({
  title,
  aiLabel = "AI",
  tone = "primary",
  compact = false,
  showMark = true
}: {
  readonly title: string
  readonly aiLabel?: string
  readonly tone?: "primary" | "accent" | "blush" | "dark"
  readonly compact?: boolean
  readonly showMark?: boolean
}) => {
  const { color } = useTheme()
  const styles = {
    primary: {
      fg: color.primaryDeep,
      pillBg: fade(color.primaryDark, 0.13),
      pillFg: color.primaryDeep
    },
    accent: {
      fg: color.accent,
      pillBg: fade(color.accent, 0.13),
      pillFg: color.accent
    },
    blush: {
      fg: "#5B3B36",
      pillBg: "rgba(176, 61, 91, 0.12)",
      pillFg: color.accent
    },
    dark: {
      fg: color.onPrimaryDark,
      pillBg: "rgba(255, 255, 255, 0.16)",
      pillFg: color.onPrimaryDark
    }
  }[tone]

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? 5 : 6, alignSelf: "flex-start" }}>
      {showMark ? <KotoriMark size={compact ? 16 : 19} mood="happy" sparkle /> : null}
      <Text
        variant="caption"
        weight="bold"
        style={{
          color: styles.fg,
          fontSize: compact ? 11.5 : 12,
          lineHeight: compact ? 15 : 16,
          letterSpacing: 0.15
        }}
      >
        {title}
      </Text>
      <View
        style={{
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: 5,
          backgroundColor: styles.pillBg,
          flexDirection: "row",
          alignItems: "center"
        }}
      >
        <Text
          variant="label"
          weight="bold"
          style={{
            color: styles.pillFg,
            fontSize: 9.5,
            lineHeight: 12,
            letterSpacing: 0.6
          }}
        >
          {aiLabel}
        </Text>
      </View>
    </View>
  )
}
