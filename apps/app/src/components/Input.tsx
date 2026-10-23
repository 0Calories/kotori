import { forwardRef, useState } from "react"
import { TextInput, type TextInputProps, View } from "react-native"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Text } from "./Text.tsx"

export interface InputProps extends TextInputProps {
  readonly label?: string
  /** Use the Japanese face for what's typed. */
  readonly jp?: boolean
  readonly large?: boolean
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ label, jp, large, style, maxLength, value, ...props }, ref) => {
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    return (
      <View style={{ gap: 6 }}>
        {label ? (
          <Text variant="caption" color="textMuted" style={{ paddingHorizontal: 4 }}>
            {label}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          value={value}
          maxLength={maxLength}
          placeholderTextColor={theme.color.textFaint}
          onFocus={(e) => {
            setFocused(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            props.onBlur?.(e)
          }}
          style={[
            {
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.md,
              borderWidth: 1.5,
              borderColor: focused ? theme.color.primaryDark : theme.color.border,
              paddingHorizontal: 16,
              paddingVertical: large ? 14 : 12,
              minHeight: large ? 110 : undefined,
              // 17px keeps iOS Safari from zooming into the field.
              fontSize: large ? 19 : 17,
              lineHeight: large ? 27 : 23,
              color: theme.color.text,
              fontFamily: jp ? theme.font.japanese.medium : theme.font.medium,
              textAlignVertical: large ? "top" : "center"
            },
            { outlineStyle: "none" } as object,
            style
          ]}
          {...props}
        />
        {maxLength && value && value.length > maxLength * 0.8 ? (
          <Text variant="caption" color="textFaint" align="right">
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
    )
  }
)
