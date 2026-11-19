import type { Language } from "@kotori/contracts"

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const findForm = (sentence: string, forms: ReadonlyArray<string>, language: Language): string | undefined => {
  if (language === "ja") return forms.find((form) => form.length > 0 && sentence.includes(form))
  const alternatives = [...new Set(forms.filter((form) => form.length > 0))].sort((a, b) => b.length - a.length)
  if (alternatives.length === 0) return undefined
  // Whole words only, without lookbehind, which not every engine the app runs on supports.
  const match = new RegExp(`(^|[^A-Za-z'])(${alternatives.map(escape).join("|")})(?![A-Za-z])`, "i").exec(sentence)
  return match?.[2]
}
