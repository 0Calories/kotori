import type { Language } from "@kotori/domain"

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Where a word appears in a sentence, as written there, to mark it: any of its forms for
 * Japanese (食べる, たべる), any of its spellings or inflections as a whole word for English
 * ("ate" in "I ate too much"), longest first so "eaten" isn't marked as "eat".
 */
export const findForm = (sentence: string, forms: ReadonlyArray<string>, language: Language): string | undefined => {
  if (language === "ja") return forms.find((form) => form.length > 0 && sentence.includes(form))
  const alternatives = [...new Set(forms.filter((form) => form.length > 0))].sort((a, b) => b.length - a.length)
  if (alternatives.length === 0) return undefined
  // Whole words only, without lookbehind, which not every engine the app runs on supports.
  const match = new RegExp(`(^|[^A-Za-z'])(${alternatives.map(escape).join("|")})(?![A-Za-z])`, "i").exec(sentence)
  return match?.[2]
}
