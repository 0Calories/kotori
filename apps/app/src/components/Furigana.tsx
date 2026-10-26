import { furiganaToText, parseFurigana } from "@kotori/domain"
import { View } from "react-native"
import { usePreference } from "../session/preferences.ts"
import { theme, type Palette } from "../theme/tokens.ts"
import { mistakeRanges, type Piece, Squiggles, useBoxes } from "./Squiggle.tsx"
import { Text } from "./Text.tsx"

interface Unit {
  readonly base: string
  readonly reading: string | null
  /** Where the unit starts in the plain sentence. */
  readonly start: number
}

/** A stretch of the sentence to mark: the word being looked up, or a mistake. */
export interface Mark {
  readonly text: string
  readonly kind: "highlight" | "mistake"
}

const NO_MARKS: ReadonlyArray<Mark> = []

/** Murecho's ascent plus descent, as a share of the size: the height of its glyph box. */
const GLYPH_BOX = 1.448

/**
 * Japanese text with readings above the kanji. Furigana arrives inline as
 * `{漢字|かんじ}`; every other character is laid out individually so lines can
 * wrap anywhere, as Japanese text does. Readings sit just above the kanji and
 * overhang the line's leading instead of adding to it, as a browser sets
 * `<ruby>`, so give furigana a line height of 1.6 or more. Marks are drawn
 * under whole units, so they look the same on every platform: a marker behind
 * the looked-up word, and a squiggle under each mistake that runs unbroken
 * along each line.
 */
export const Furigana = ({
  text,
  furigana,
  size = 20,
  lineHeight = Math.round(size * 1.6),
  color = "text",
  center,
  marks = NO_MARKS
}: {
  readonly text: string
  readonly furigana?: string | null
  readonly size?: number
  /** The height of a line of base text, not counting the readings above it. */
  readonly lineHeight?: number
  readonly color?: keyof Palette
  readonly center?: boolean
  readonly marks?: ReadonlyArray<Mark>
}) => {
  const [showFurigana] = usePreference("furigana", true)
  const [boxes, measure] = useBoxes()
  const ruby = showFurigana && furigana ? furigana : null
  const plain = ruby === null ? text : furiganaToText(ruby)
  const highlights = marks.flatMap((mark) => {
    const start = mark.kind === "highlight" && mark.text.length > 0 ? plain.indexOf(mark.text) : -1
    return start < 0 ? [] : [{ start, end: start + mark.text.length }]
  })
  const mistakes = mistakeRanges(
    plain,
    marks.filter((mark) => mark.kind === "mistake").map((mark) => mark.text)
  )

  if (ruby === null && highlights.length + mistakes.length === 0) {
    return (
      <Text
        jp
        weight="medium"
        size={size}
        color={color}
        align={center ? "center" : undefined}
        style={{ lineHeight }}
        selectable
      >
        {text}
      </Text>
    )
  }

  const pieces = (ruby === null ? [{ text, reading: null }] : parseFurigana(ruby)).flatMap(
    (segment): Array<Omit<Unit, "start">> =>
      segment.reading !== null
        ? [{ base: segment.text, reading: segment.reading }]
        : Array.from(segment.text, (char) => ({ base: char, reading: null }))
  )
  const units = pieces.map((piece, index): Unit => ({
    ...piece,
    start: pieces.slice(0, index).reduce((length, before) => length + before.base.length, 0)
  }))
  const overlaps = (unit: Unit) => (range: { readonly start: number; readonly end: number }) =>
    unit.start < range.end && unit.start + unit.base.length > range.start
  const rubySize = Math.max(Math.round(size * 0.5), 9)
  const rubyLine = Math.round(rubySize * GLYPH_BOX)
  // How far a reading reaches above the line box: its glyph box ends on top of the kanji's em box.
  const overhang = Math.round(rubyLine / 2 + (GLYPH_BOX / 2) * rubySize - lineHeight / 2 + 0.444 * size)
  const glyphBox = Math.round(GLYPH_BOX * size)
  // Each unit's base line is the bottom of its box; the squiggles are drawn against that line.
  const squiggled = units.flatMap((unit): Array<Piece> => {
    const mark = mistakes.findIndex(overlaps(unit))
    const box = boxes.get(String(unit.start))
    return mark < 0 || box === undefined
      ? []
      : [
          {
            mark,
            space: unit.base.trim().length === 0,
            box: { x: box.x, y: box.y + box.height - lineHeight, width: box.width, height: lineHeight }
          }
        ]
  })

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
      <Squiggles pieces={squiggled} face="japanese" size={size} lineHeight={lineHeight} color={theme.color.accent} />
      {units.map((unit) => (
        <View
          key={unit.start}
          style={{ alignItems: "center", marginTop: ruby === null ? 0 : -overhang }}
          onLayout={mistakes.some(overlaps(unit)) ? measure(String(unit.start)) : undefined}
        >
          {ruby !== null ? (
            <Text
              jp
              weight="medium"
              size={rubySize}
              style={{ color: theme.color.textMuted, lineHeight: rubyLine, marginBottom: overhang - rubyLine }}
            >
              {unit.reading ?? "​"}
            </Text>
          ) : null}
          <View>
            {highlights.some(overlaps(unit)) ? (
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: (lineHeight - glyphBox) / 2,
                  height: Math.round(glyphBox * 0.38),
                  backgroundColor: theme.color.highlight
                }}
              />
            ) : null}
            <Text jp weight="medium" size={size} color={color} style={{ lineHeight }}>
              {unit.base}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}
