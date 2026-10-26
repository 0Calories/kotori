import { useId } from "react"
import { StyleSheet, View } from "react-native"
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg"
import { useTheme } from "../theme/ThemeProvider.tsx"

/** Four tiled layers of flakes at different spacings, so the pattern never visibly repeats. */
const LAYERS = [
  { width: 53, height: 47, x: 0.23, y: 0.31, r: 1.7 },
  { width: 31, height: 37, x: 0.71, y: 0.63, r: 1.1 },
  { width: 89, height: 79, x: 0.41, y: 0.77, r: 2.3 },
  { width: 127, height: 113, x: 0.83, y: 0.19, r: 2 }
] as const

/**
 * Light snowfall over a tinted hero. Purely decorative.
 *
 * The flakes are an SVG pattern. An `<svg>` is a replaced element, so giving it
 * only absolute edges leaves the browser's default 300×150 viewport: the snow
 * sits in a patch at the top left and never covers the hero, including after a
 * resize. A view does stretch to the hero, and the svg is 100% of that box.
 */
export const Snow = () => {
  const { color, dark } = useTheme()
  // Pattern ids are global on the web, so each instance needs its own.
  const id = `kotori-snow-${useId().replace(/[^\w-]/g, "")}`
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* `aria-hidden` rather than `accessible={false}`: react-native-svg passes unknown
          props straight to the DOM element on the web, where `accessible` isn't an attribute. */}
      <Svg width="100%" height="100%" style={{ width: "100%", height: "100%" }} pointerEvents="none" aria-hidden>
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
    </View>
  )
}
