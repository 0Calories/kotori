import { useId } from "react"
import { StyleSheet } from "react-native"
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg"
import { useTheme } from "../theme/ThemeProvider.tsx"

/** Four tiled layers of flakes at different spacings, so the pattern never visibly repeats. */
const LAYERS = [
  { width: 53, height: 47, x: 0.23, y: 0.31, r: 1.7 },
  { width: 31, height: 37, x: 0.71, y: 0.63, r: 1.1 },
  { width: 89, height: 79, x: 0.41, y: 0.77, r: 2.3 },
  { width: 127, height: 113, x: 0.83, y: 0.19, r: 2 }
] as const

/** Light snowfall over a tinted hero. Purely decorative. */
export const Snow = () => {
  const { color, dark } = useTheme()
  // Pattern ids are global on the web, so each instance needs its own.
  const id = `kotori-snow-${useId().replace(/[^\w-]/g, "")}`
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
      <Defs>
        {LAYERS.map((layer, index) => (
          <Pattern
            key={index}
            id={`${id}-${index}`}
            width={layer.width}
            height={layer.height}
            patternUnits="userSpaceOnUse"
          >
            <Circle
              cx={layer.x * layer.width}
              cy={layer.y * layer.height}
              r={layer.r}
              fill={dark ? color.textFaint : color.surface}
              fillOpacity={dark ? 0.35 : 1}
              stroke={color.primaryDark}
              strokeOpacity={dark ? 0 : 0.18}
              strokeWidth={0.8}
            />
          </Pattern>
        ))}
      </Defs>
      {LAYERS.map((_, index) => (
        <Rect key={index} width="100%" height="100%" fill={`url(#${id}-${index})`} />
      ))}
    </Svg>
  )
}
