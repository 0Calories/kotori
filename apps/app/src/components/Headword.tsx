import type { Language } from "@kotori/contracts"
import { Text, type TextProps } from "./Text.tsx"

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
