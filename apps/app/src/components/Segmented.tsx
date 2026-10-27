import { ScrollView } from "react-native"
import { theme } from "../theme/tokens.ts"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

/** A row of pills; the selected one is wakatake, the design's "selected segment". */
export const Segmented = <A extends string>({
  options,
  value,
  onChange
}: {
  readonly options: ReadonlyArray<{ readonly value: A; readonly label: string }>
  readonly value: A
  readonly onChange: (value: A) => void
}) => {
  const { color, radius } = theme
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <PressableScale
            key={option.value}
            haptic
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              height: 36,
              justifyContent: "center",
              paddingHorizontal: 15,
              borderRadius: radius.pill,
              backgroundColor: selected ? color.primary : color.surface,
              borderWidth: 1,
              borderColor: selected ? color.primary : color.border
            }}
          >
            <Text
              variant="caption"
              size={14}
              weight={selected ? "bold" : "medium"}
              style={{ color: selected ? color.onPrimary : color.text }}
            >
              {option.label}
            </Text>
          </PressableScale>
        )
      })}
    </ScrollView>
  )
}
