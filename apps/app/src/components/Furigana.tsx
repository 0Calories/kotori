import { furiganaToText, parseFurigana } from "@kotori/domain"
import { View } from "react-native"
import { usePreference } from "../session/preferences.ts"
import { useTheme } from "../theme/ThemeProvider.tsx"
import type { Palette } from "../theme/tokens.ts"
import { Text } from "./Text.tsx"

interface Unit {
  readonly base: string
  readonly reading: string | null
}

/** A stretch of the sentence to mark: the word being looked up, or a mistake. */
export interface Mark {
  readonly text: string
  readonly kind: "highlight" | "mistake"
}

/**
 * Japanese text with readings above the kanji. Furigana arrives inline as
 * `{漢字|かんじ}`; every other character is laid out individually so lines can
 * wrap anywhere, as Japanese text does. Marks are drawn under whole units, so
 * they look the same on every platform.
 */
export const Furigana = ({
  text,
  furigana,
  size = 20,
  color = "text",
  center,
  marks = []
}: {
  readonly text: string
  readonly furigana?: string | null
  readonly size?: number
  readonly color?: keyof Palette
  readonly center?: boolean
  readonly marks?: ReadonlyArray<Mark>
}) => {
  const theme = useTheme()
  const [showFurigana] = usePreference("furigana", true)
  const ruby = showFurigana && furigana ? furigana : null
  const plain = ruby === null ? text : furiganaToText(ruby)
  const spans = marks.flatMap((mark) => {
    const start = mark.text.length > 0 ? plain.indexOf(mark.text) : -1
    return start < 0 ? [] : [{ start, end: start + mark.text.length, kind: mark.kind }]
  })

  if (ruby === null && spans.length === 0) {
    return (
      <Text jp weight="medium" size={size} color={color} align={center ? "center" : undefined} selectable>
        {text}
      </Text>
    )
  }

  const units = (ruby === null ? [{ text, reading: null }] : parseFurigana(ruby)).flatMap((segment): Array<Unit> =>
    segment.reading !== null
      ? [{ base: segment.text, reading: segment.reading }]
      : Array.from(segment.text, (char) => ({ base: char, reading: null }))
  )
  const rubySize = Math.max(Math.round(size * 0.5), 9)
  const lineHeight = Math.round(size * 1.5)
  let offset = 0

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-end",
        justifyContent: center ? "center" : "flex-start"
      }}
      accessible
      accessibilityLabel={text}
    >
      {units.map((unit, index) => {
        const start = offset
        offset += unit.base.length
        const mark = spans.find((span) => start < span.end && offset > span.start)
        return (
          <View key={index} style={{ alignItems: "center" }}>
            {ruby !== null ? (
              <Text jp size={rubySize} style={{ color: theme.color.textMuted, lineHeight: rubySize * 1.25 }}>
                {unit.reading ?? "​"}
              </Text>
            ) : null}
            <View>
              {mark ? (
                <View
                  style={
                    mark.kind === "highlight"
                      ? {
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: Math.round(lineHeight * 0.38),
                          backgroundColor: theme.color.highlight
                        }
                      : {
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 1,
                          height: 2,
                          borderRadius: 1,
                          backgroundColor: theme.color.accentMark
                        }
                  }
                />
              ) : null}
              <Text jp weight="medium" size={size} color={color} style={{ lineHeight }}>
                {unit.base}
              </Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}
