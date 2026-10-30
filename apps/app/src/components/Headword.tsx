import type { Language } from "@kotori/domain"
import { Text, type TextProps } from "./Text.tsx"

/** A word being learned, in its language's face: Hina Mincho for Japanese, Gabarito for English. */
export const Headword = ({
  language,
  size,
  children,
  ...props
}: Omit<TextProps, "mincho" | "jp" | "variant" | "size"> & { readonly language: Language; readonly size: number }) =>
  language === "ja" ? (
    <Text mincho size={size} {...props}>
      {children}
    </Text>
  ) : (
    <Text variant="display" size={size} {...props}>
      {children}
    </Text>
  )
