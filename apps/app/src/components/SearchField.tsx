import { forwardRef } from "react"
import { Platform, TextInput, View } from "react-native"
import { useSession } from "../session/SessionProvider.tsx"
import { useTheme } from "../theme/ThemeProvider.tsx"
import { Icon } from "./Icon.tsx"
import { PressableScale } from "./PressableScale.tsx"

/** The rounded search field: a magnifier, what's typed, and a button to clear it once there is any. */
export const SearchField = forwardRef<
  TextInput,
  {
    readonly value: string
    readonly onChangeText: (text: string) => void
    readonly placeholder: string
    /** The dictionary's field stands tall under its header; others sit in a page's flow. */
    readonly size?: "lg" | "md"
  }
>(({ value, onChangeText, placeholder, size = "lg" }, ref) => {
  const theme = useTheme()
  const { t } = useSession()
  const active = value.trim().length > 0
  const height = size === "lg" ? 60 : 50
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          height,
          borderRadius: height / 2,
          backgroundColor: theme.color.surface,
          paddingLeft: size === "lg" ? 18 : 16,
          paddingRight: size === "lg" ? 8 : 4,
          borderWidth: 1.5,
          borderColor: active ? theme.color.primaryDark : size === "lg" ? "transparent" : theme.color.border
        },
        size === "lg" ? theme.shadow(2) : null
      ]}
    >
      <Icon name="search" size={size === "lg" ? 24 : 22} color={theme.color.textMuted} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={[
          {
            flex: 1,
            // 16px on the web keeps iOS Safari from zooming into the field; the mock's 15.5 elsewhere.
            fontSize: Platform.OS === "web" ? 16 : 15.5,
            color: theme.color.text,
            fontFamily: theme.font.regular,
            height: "100%"
          },
          { outlineStyle: "none" } as object
        ]}
      />
      {active ? (
        <PressableScale
          onPress={() => onChangeText("")}
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="cancel" size={22} filled color={theme.color.textFaint} />
        </PressableScale>
      ) : null}
    </View>
  )
})
