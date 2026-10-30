import { View } from "react-native"
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

export interface ScaleRow {
  readonly left: string
  readonly right: string
  /** 0..1 from the left end. */
  readonly position: number
  /** What the dot says in words, for screen readers. */
  readonly value: string
  /** Low-confidence judgments are drawn lighter. */
  readonly faded?: boolean
}

/** Each row is as tall as its labels; the dot overhangs the row. */
const ROW = 12.5
const GAP = 16

const Track = ({ row }: { readonly row: ScaleRow }) => {
  const { color } = useTheme()
  const clamped = Math.min(Math.max(row.position, 0), 1)
  const dot = useAnimatedStyle(() => ({
    left: withSpring(`${clamped * 100}%`, { duration: 600, dampingRatio: 0.8 })
  }))
  return (
    <View style={{ height: ROW, justifyContent: "center", opacity: row.faded ? 0.45 : 1 }}>
      <View style={{ height: 2, borderRadius: 1, backgroundColor: color.track }} />
      <Animated.View
        style={[
          {
            position: "absolute",
            top: (ROW - 18) / 2,
            width: 18,
            height: 18,
            marginLeft: -9,
            borderRadius: 9,
            borderWidth: 3,
            borderColor: color.surface,
            backgroundColor: color.primaryDark
          },
          dot
        ]}
      />
    </View>
  )
}

/**
 * Where a word sits on each nuance scale: a dot on a line between two poles.
 * Laid out in columns, like a table, so every track starts and ends together.
 */
export const NuanceScales = ({ rows }: { readonly rows: ReadonlyArray<ScaleRow> }) => {
  const label = (side: "left" | "right") => (
    <View style={{ gap: GAP, alignItems: side === "left" ? "flex-end" : "flex-start" }}>
      {rows.map((row) => (
        <View key={row.left} style={{ height: ROW, justifyContent: "center", opacity: row.faded ? 0.6 : 1 }}>
          <Text variant="caption" color="textMuted">
            {row[side]}
          </Text>
        </View>
      ))}
    </View>
  )
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={rows.map((row) => `${row.left}–${row.right}: ${row.value}`).join(". ")}
      style={{ flexDirection: "row", gap: 12 }}
    >
      {label("left")}
      <View style={{ flex: 1, gap: GAP }}>
        {rows.map((row) => (
          <Track key={row.left} row={row} />
        ))}
      </View>
      {label("right")}
    </View>
  )
}
