import { ScrollView } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { PressableScale } from "./PressableScale.tsx"
import { Text } from "./Text.tsx"

export const Segmented = <A extends string>({
  options,
  value,
  onChange
}: {
  readonly options: ReadonlyArray<{ readonly value: A; readonly label: string }>
  readonly value: A
  readonly onChange: (value: A) => void
}) => {
  const { color, radius } = useTheme()
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
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: selected ? color.ink : color.surface,
              borderWidth: 1.5,
              borderColor: selected ? color.ink : color.border
            }}
          >
            <Text variant="caption" style={{ color: selected ? color.background : color.text }}>
              {option.label}
            </Text>
          </PressableScale>
        )
      })}
    </ScrollView>
  )
}
