import { useRouter } from "expo-router"
import { useCallback, useEffect } from "react"
import { Platform, Pressable, View, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { fade } from "../theme/tokens.ts"
import { Icon } from "./Icon.tsx"
import { Text } from "./Text.tsx"

export interface PrototypeVariantOption<K extends string = string> {
  readonly key: K
  readonly name: string
  readonly summary?: string
}

const isEditableElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

/**
 * PROTOTYPE: Floating bottom-centre variant switcher (`?variant=`).
 * Cycles with the left/right arrows or keyboard `←` / `→` keys; hidden in production builds.
 */
export const PrototypeSwitcher = <K extends string>({
  variants,
  current,
  stateSummary,
  onSelect
}: {
  readonly variants: ReadonlyArray<PrototypeVariantOption<K>>
  readonly current: K
  readonly stateSummary?: string
  readonly onSelect?: (next: K) => void
}) => {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const index = Math.max(
    0,
    variants.findIndex((item) => item.key === current)
  )
  const active = variants[index] ?? variants[0]

  const select = useCallback(
    (next: K) => {
      if (onSelect) onSelect(next)
      else router.setParams({ variant: next })
    },
    [onSelect, router]
  )

  const step = useCallback(
    (delta: -1 | 1) => {
      if (variants.length === 0) return
      const nextIndex = (index + delta + variants.length) % variants.length
      const target = variants[nextIndex]
      if (target) select(target.key)
    },
    [index, select, variants]
  )

  useEffect(() => {
    if (Platform.OS !== "web" || process.env.NODE_ENV === "production") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableElement(event.target)) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        step(-1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        step(1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [step])

  if (process.env.NODE_ENV === "production" || !active) return null

  const dockStyle: ViewStyle =
    Platform.OS === "web"
      ? ({
          position: "fixed",
          left: 0,
          right: 0,
          bottom: Math.max(insets.bottom, 16),
          alignItems: "center",
          paddingHorizontal: 14,
          zIndex: 950
        } as unknown as ViewStyle)
      : {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: Math.max(insets.bottom, 14),
          alignItems: "center",
          paddingHorizontal: 14,
          zIndex: 950
        }

  return (
    <View pointerEvents="box-none" style={dockStyle}>
      <View
        style={{
          backgroundColor: "#111920",
          borderRadius: 999,
          borderWidth: 1,
          borderColor: "rgba(255, 255, 255, 0.14)",
          paddingHorizontal: 6,
          paddingVertical: 5,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          maxWidth: 520,
          ...(Platform.OS === "web"
            ? { boxShadow: `0 16px 36px -10px ${fade("#0A1015", 0.52)}` }
            : {
                shadowColor: "#0A1015",
                shadowOpacity: 0.34,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
                elevation: 8
              })
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous variant"
          onPress={() => step(-1)}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.09)"
          })}
        >
          <Icon name="arrow_back" size={18} color="#FFFFFF" />
        </Pressable>

        <View style={{ paddingHorizontal: 10, alignItems: "center", flexShrink: 1 }}>
          <Text variant="caption" weight="bold" numberOfLines={1} style={{ color: "#FFFFFF", lineHeight: 16 }}>
            {`${active.key} (${active.name})`}
          </Text>
          {stateSummary ? (
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: "rgba(255, 255, 255, 0.65)", fontSize: 11, lineHeight: 14 }}
            >
              {stateSummary}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next variant"
          onPress={() => step(1)}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.09)"
          })}
        >
          <Icon name="arrow_forward" size={18} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  )
}
