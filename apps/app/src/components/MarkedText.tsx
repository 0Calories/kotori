import { View } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

// Gabarito's ascent + descent as a fraction of fontSize.
const GLYPH_BOX = 1.2

export const MarkedText = ({
  text,
  mark,
  size = 16,
  lineHeight = 22
}: {
  readonly text: string
  readonly mark: string | undefined
  readonly size?: number
  readonly lineHeight?: number
}) => {
  const theme = useTheme()
  const start = mark === undefined || mark.length === 0 ? -1 : text.indexOf(mark)
  if (mark === undefined || start < 0) {
    return (
      <Text variant="strong" size={size} style={{ lineHeight }} selectable>
        {text}
      </Text>
    )
  }
  const words = (part: string) => part.match(/\S+\s*|\s+/g) ?? []
  const pieces = [
    ...words(text.slice(0, start)).map((piece) => ({ piece, marked: false })),
    { piece: mark, marked: true },
    ...words(text.slice(start + mark.length)).map((piece) => ({ piece, marked: false }))
  ]
  const glyphBox = Math.round(GLYPH_BOX * size)
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }} accessible accessibilityLabel={text}>
      {pieces.map(({ piece, marked }, index) => (
        <View key={index}>
          {marked ? (
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
          <Text variant="strong" size={size} style={{ lineHeight }}>
            {piece}
          </Text>
        </View>
      ))}
    </View>
  )
}
