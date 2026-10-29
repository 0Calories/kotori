import { View } from "react-native"
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated"
import { theme } from "../theme/tokens.ts"
import { Text } from "./Text.tsx"

export interface ScaleRow {
  readonly left: string
  readonly right: string
  /** 0..1 from the left end. */
  readonly position: number
  /** What the dot says in words, for screen readers and (when labelled) under the dot. */
  readonly value: string
  /** Low-confidence judgments are drawn lighter. */
  readonly faded?: boolean
  /** Marks this many evenly spaced ticks on the track, for scales with discrete stops. */
  readonly stops?: number
}

/** Each row is as tall as its labels; the dot overhangs the row. */
const ROW = 12.5
const GAP = 16
/** Room for the value written under the dot when the scales are labelled. */
const VALUE = 18

const Track = ({ row, labelled }: { readonly row: ScaleRow; readonly labelled: boolean }) => {
  const { color } = theme
  const clamped = Math.min(Math.max(row.position, 0), 1)
  const dot = useAnimatedStyle(() => ({
    left: withSpring(`${clamped * 100}%`, { duration: 600, dampingRatio: 0.8 })
  }))
  return (
    <View style={{ opacity: row.faded ? 0.45 : 1 }}>
      <View style={{ height: ROW, justifyContent: "center" }}>
        <View style={{ height: 2, borderRadius: 1, backgroundColor: color.track }} />
        {row.stops && row.stops > 1
          ? Array.from({ length: row.stops }, (_, stop) => (
              <View
                key={stop}
                style={{
                  position: "absolute",
                  left: `${(stop / (row.stops! - 1)) * 100}%`,
                  top: (ROW - 7) / 2,
                  width: 2,
                  height: 7,
                  marginLeft: -1,
                  borderRadius: 1,
                  backgroundColor: color.track
                }}
              />
            ))
          : null}
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
      {labelled ? (
        <View style={{ height: VALUE, justifyContent: "flex-end" }}>
          {/* A zero-width anchor at the dot; the fixed-width text centres itself on it. */}
          <View style={{ position: "absolute", left: `${clamped * 100}%`, bottom: 0, width: 0, alignItems: "center" }}>
            <Text variant="caption" color="textMuted" numberOfLines={1} style={{ width: 160, textAlign: "center" }}>
              {row.value}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Where a word sits on each nuance scale: a dot on a line between two poles.
 * Laid out in columns, like a table, so every track starts and ends together.
 */
export const NuanceScales = ({
  rows,
  labelled = false
}: {
  readonly rows: ReadonlyArray<ScaleRow>
  /** Writes each row's value under its dot. */
  readonly labelled?: boolean
}) => {
  const height = ROW + (labelled ? VALUE : 0)
  const label = (side: "left" | "right") => (
    <View style={{ gap: GAP, alignItems: side === "left" ? "flex-end" : "flex-start" }}>
      {rows.map((row) => (
        <View key={row.left} style={{ height, opacity: row.faded ? 0.6 : 1 }}>
          <View style={{ height: ROW, justifyContent: "center" }}>
            <Text variant="caption" color="textMuted">
              {row[side]}
            </Text>
          </View>
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
          <Track key={row.left} row={row} labelled={labelled} />
        ))}
      </View>
      {label("right")}
    </View>
  )
}
